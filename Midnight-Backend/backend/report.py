"""
The Midnight Report: a newsletter-style edition written from the articles this pipeline has published, and
pushed to MongoDB `reports` in the shape the Lovable app reads (src/lib/reports.server.ts):

  {date, status, title, introduction, leadTitle, leadExcerpt, leadParagraphs,
   sections: [{tag, title, paragraphs}], lastWord}

When a report is written
  * FIXED SCHEDULE, no drift. Each edition belongs to a UTC date and is due at REPORT_EDITION_TIME_UTC
    (default 13:00). Writing starts REPORT_LEAD_MINUTES early (default 30), i.e. at 12:30 UTC, so it is
    published before 13:00. When a report is written never moves the next one: tomorrow's is due at 12:30 again.
  * Safety nets so a report is never missed (they only ever catch up; none of them moves the schedule):
      - ReportLoop wakes when the pipeline starts, then every HOUR, and sooner if the deadline is nearer;
      - if a deadline passed and nothing has been written since (pipeline was down, crashed...), the report is
        written at once, labelled with that missed edition's date;
      - a 24-hour check: if nothing at all was written for 24h+1h, today's report is written at once;
      - a loop error is retried after 1 minute; too few stories is retried every 5 minutes.
  * A due report is written UNTIL IT EXISTS. A draft that is cut off, too thin, badly shaped or rejected by
    the fact-check is corrected and rewritten straight away, with no back-off and no give-up. The only waiting
    is for a usable API key (seconds at a time).
  * The only thing that can hold a due report is having fewer than MIN_STORIES stories to write about; then
    the loop looks again every 5 minutes.

What goes in
  * The WINDOW: every article written since the previous report was written (its windowEnd) up to now. With
    no previous report it is the last 24 hours. Consecutive windows touch exactly: nothing is missed and
    nothing is told twice.
  * It reads EVERY article in the window, ranks them with the importance weights the website hero uses
    (headlines.py) and keeps the important ones (at most REPORT_MAX_STORIES, default 12).
  * The finished newsletter is FACT-CHECKED against those stories (factcheck.verify_report) before it is stored.
  * One edition per UTC date (unique index).
"""

import re
import threading
import time
from datetime import datetime, timedelta, timezone

from pymongo.errors import DuplicateKeyError

import factcheck
import llm
from quality import Incomplete, strip_end_marker, check_newsletter, END_MARKER
from schema import now_iso, iso
import headlines

REPORT_VALIDATOR = {  # identical to lovable reports.server.ts reportValidator
    "$jsonSchema": {
        "bsonType": "object",
        "required": ["date", "status", "title", "leadTitle", "sections"],
        "properties": {
            "date": {"bsonType": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
            "status": {"enum": ["draft", "published"]},
            "title": {"bsonType": "string"},
            "introduction": {"bsonType": "string"},
            "leadTitle": {"bsonType": "string"},
            "leadExcerpt": {"bsonType": "string"},
            "leadParagraphs": {"bsonType": "array", "items": {"bsonType": "string"}},
            "sections": {"bsonType": "array", "items": {
                "bsonType": "object", "required": ["tag", "title", "paragraphs"],
                "properties": {"tag": {"bsonType": "string"}, "title": {"bsonType": "string"},
                               "paragraphs": {"bsonType": "array", "items": {"bsonType": "string"}}}}},
            "lastWord": {"bsonType": "string"},
        },
    }
}

REPORT_KEYS = {"date", "status", "title", "introduction", "leadTitle", "leadExcerpt",
               "leadParagraphs", "sections", "lastWord"}


def ensure_reports_collection(db):
    if "reports" not in db.list_collection_names():
        try:
            db.create_collection("reports", validator=REPORT_VALIDATOR, validationLevel="moderate")
        except Exception:
            pass
    try:
        db["reports"].create_index("date", unique=True, name="one_edition_per_date")
    except Exception:
        pass  # an equivalent index already exists


# ---------------------------------------------------------------- writing
IMPORTANT_MIN_WEIGHT = 50     # headlineWeight an article needs to count as "important"
MIN_STORIES = 5               # top up to this many if too few pass the bar
MAX_PER_TAG = 4               # one beat cannot take over the newsletter
BODY_CHARS = 1100             # how much of each article the editor gets to read


FALLBACK_WINDOW_HOURS = 24    # first report ever: look back this far


def day_bounds(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return iso(d), iso(d + timedelta(days=1))


def report_window(runs_col, now):
    """(start_iso, end_iso): from the end of the previous report's window to now.
    No previous report: the last 24 hours."""
    last = runs_col.find_one({}, sort=[("windowEnd", -1)])
    start = last["windowEnd"] if last and last.get("windowEnd") else iso(now - timedelta(hours=FALLBACK_WINDOW_HOURS))
    return start, iso(now)


def window_articles(storage, lo, hi):
    """Every published article WRITTEN in [lo, hi), including ones that were already in the
    system before this run started."""
    return list(storage.articles.find(
        {"status": "published", "provenance.content": "measured", "createdAt": {"$gte": lo, "$lt": hi}},
        {"title": 1, "excerpt": 1, "tag": 1, "summary": 1, "body": 1, "source_name": 1,
         "publishedAt": 1, "headlineWeight": 1, "id": 1, "section": 1}))


def day_articles(storage, date_str):
    """Every published article written on that UTC calendar day (kept for callers that want a day)."""
    return window_articles(storage, *day_bounds(date_str))


def pick_important(docs, max_stories=12):
    """Highest headlineWeight first (ties: newest). Keeps what clears the
    importance bar, tops up to MIN_STORIES, caps at max_stories and per tag."""
    ranked = sorted(docs, key=lambda d: (d.get("headlineWeight") or 0, d.get("publishedAt") or ""), reverse=True)
    out, per = [], {}
    for pass_min in (IMPORTANT_MIN_WEIGHT, 0):
        for d in ranked:
            if len(out) >= max_stories or d in out:
                continue
            if pass_min and (d.get("headlineWeight") or 0) < pass_min:
                continue
            if not pass_min and len(out) >= MIN_STORIES:
                break
            if per.get(d["tag"], 0) >= MAX_PER_TAG:
                continue
            per[d["tag"]] = per.get(d["tag"], 0) + 1
            out.append(d)
    return sorted(out, key=lambda d: (d.get("headlineWeight") or 0, d.get("publishedAt") or ""), reverse=True)


def gather_material(storage, window, max_stories=12):
    """window = (lo_iso, hi_iso). Returns (window_total, important_stories)."""
    docs = window_articles(storage, *window)
    return len(docs), pick_important(docs, max_stories)


def _story_block(i, m):
    body = " ".join(m.get("body") or [])[:BODY_CHARS].rsplit(" ", 1)[0] if m.get("body") else ""
    points = " | ".join(m.get("summary", []))
    return (f"STORY {i} [{m['tag']}] {m['title']}\n"
            f"Teaser: {m['excerpt']}\nKey points: {points}\nDetails: {body}")


def _fmt_window(w):
    lo, hi = w
    return f"{lo[:16].replace('T', ' ')} to {hi[:16].replace('T', ' ')} UTC"


def story_source(material):
    """The stories exactly as the editor sees them. The fact-check compares the newsletter to THIS text."""
    return "\n\n".join(_story_block(i, m) for i, m in enumerate(material, 1))


VOICE = """VOICE: you are the smart, funny friend who read everything so the reader does not have to.
- Conversational and warm. Talk to the reader as "you". Contractions are good. Plain words beat fancy ones.
- Confident and a little irreverent, never snarky about people who are suffering. No jokes about deaths,
  disasters, violence, illness or war: when a story is grave, tell it straight and calm.
- Business and tech jargon gets a quick plain-English translation, or a small everyday comparison that
  is obviously a figure of speech and asserts no fact.
- Every item opens with a punchy hook sentence that carries the news itself. Then the details a reader
  needs: who, what, the numbers, the reasons, the reactions, what it changes. Short paragraphs, 1-3
  sentences each. Vary the rhythm: a short line now and then lands well.
- Headlines are snappy and can use wordplay on lighter stories (markets, tech, culture, sport). They
  must still say what happened, and wordplay must not state anything the stories do not.
- You may open a paragraph with a short plain label such as "Why it matters:", "The big picture:" or
  "By the numbers:", sparingly and only where it helps. Plain text only: no markdown, no asterisks,
  no bullet characters, no emoji, no all-caps, no hashtags.
- Do not mention the time of day or "good morning". Do not talk about the newsletter itself, about
  being given stories, or about being an AI. No clickbait, no "you won't believe", no filler like
  "it remains to be seen".
- THE WIT LIVES IN THE PHRASING, NEVER IN THE FACTS. Every number, name, place, date, quotation, cause
  and outcome must come from the stories below. A joke may not smuggle in a fact. A fact-checker will
  compare every line to the stories and reject the newsletter for anything they do not support."""


def _prompt(material, date_str, window):
    stories = story_source(material)
    tags = sorted({m["tag"] for m in material})
    n = len(material)
    return f"""You write The Midnight Report, a daily newsletter for busy people who do NOT want to read
the news. The reader will read ONLY this newsletter, so each story must still tell them everything they
need to know: who, what, where, when, the numbers, the names, the reasons, the reactions, what it changes
and what happens next. Dense, but easy and fun to read. Not a one-line summary and not a long article.

{VOICE}

Edition: {date_str}. It covers everything reported since the last edition ({_fmt_window(window)}), so
do not describe it as "today". Use ONLY the facts in the {n} stories below. Do not add facts, quotes,
numbers or names that are not in them.

STORIES (already ranked, most important first):

{stories}

Structure to write:
- TITLE: the edition headline, naming the one or two biggest stories.
- INTRODUCTION: 1-2 sentences, under 450 characters, a friendly hook that says what the news was about.
- LEAD: STORY 1 told in full, 2-4 short paragraphs, 200-320 words in total.
- One SECTION for EACH remaining story (STORY 2 to STORY {n}), in the same order, with the tag of
  that story. Each has a headline and 1-3 short paragraphs, 60-130 words in total, giving the
  reader every key detail.
- LAST_WORD: 2-3 sentences with a light sign-off and what to watch next, based only on things the
  stories say are scheduled, pending or unresolved.

Available section tags: {', '.join(tags)}

Respond in EXACTLY this format, nothing before or after:

TITLE: <edition title, one line>
INTRODUCTION: <one line>
LEAD_TITLE: <lead headline, one line>
LEAD_EXCERPT: <one or two sentences, one line>
LEAD:
<lead paragraph 1>

<lead paragraph 2>
SECTION: <tag> | <story headline>
<paragraph>

<paragraph>
SECTION: <tag> | <story headline>
<paragraph>
LAST_WORD:
<closing paragraph>
{END_MARKER}"""


def parse_report(raw, date_str, valid_tags, story_tags=None):
    def line(name):
        m = re.search(rf"^{name}:\s*(.+)$", raw, re.M)
        if not m:
            raise Incomplete(f"report is missing {name}")
        return m.group(1).strip()

    def paras(block):
        return [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", block.strip()) if p.strip()]

    lead_m = re.search(r"^LEAD:\s*\n(.*?)(?=^SECTION:|^LAST_WORD:)", raw, re.M | re.S)
    last_m = re.search(r"^LAST_WORD:\s*\n(.*)\Z", raw, re.M | re.S)
    if not lead_m or not last_m:
        raise Incomplete("report is missing LEAD or LAST_WORD")
    sections = []
    for m in re.finditer(r"^SECTION:\s*([^|\n]+?)\s*\|\s*([^\n]+)\n(.*?)(?=^SECTION:|^LAST_WORD:)", raw, re.M | re.S):
        tag = m.group(1).strip()
        match = next((t for t in valid_tags if t.lower() == tag.lower()), None)
        if not match:
            # The model wrote its own label ("Tech & AI"). Sections follow the stories in order (story 2, 3, ...),
            # so use that story's real tag instead of throwing the whole newsletter away.
            i = len(sections) + 1
            match = story_tags[i] if story_tags and i < len(story_tags) else (valid_tags[0] if valid_tags else tag)
        sections.append({"tag": match, "title": m.group(2).strip(), "paragraphs": paras(m.group(3))})
    return {
        "date": date_str, "status": "published",
        "title": line("TITLE"), "introduction": line("INTRODUCTION"),
        "leadTitle": line("LEAD_TITLE"), "leadExcerpt": line("LEAD_EXCERPT"),
        "leadParagraphs": paras(lead_m.group(1)), "sections": sections,
        "lastWord": " ".join(paras(last_m.group(1))),
    }


class Unsupported(Exception):
    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("; ".join(self.problems[:3]))


def _temperature(round_no):
    """Looser first, stricter the more often the fact-check has rejected the draft."""
    return 0.5 if round_no <= 3 else 0.3 if round_no <= 6 else 0.2


def write_report(material, date_str, chat=None, window=None, verify=None, on_round=None,
                 max_rounds=None, sleep=time.sleep, wait_cap=60):
    """Returns a complete, validated, FACT-CHECKED newsletter dict.

    It does NOT give up. A draft that is cut off, too thin, badly shaped or rejected by the fact-check is
    corrected and written again at once, round after round, until one passes. The only waiting is for a
    usable API key (at most `wait_cap` seconds at a time; the keys come back on their own).

      * Each round gets the original prompt plus ONLY the problems of the last two failed drafts, so the
        prompt never grows without bound.
      * After 3 failed rounds the temperature drops (0.5 -> 0.3 -> 0.2) so the model sticks to the stories.
      * Every 4 failed rounds from round 5 the least important story is dropped (never below MIN_STORIES):
        a shorter newsletter has less room for an unsupported claim and fits the token limit.

    verify(source_text, report) -> list of problems; defaults to factcheck.verify_report on the same chat.
    on_round(round_no, reason, n_stories) is called after every failed round (the dashboard shows it).
    max_rounds exists for tests only; in production it is None = no limit (raises Incomplete if reached)."""
    chat = chat or (lambda *a, **k: llm.chat(*a, purpose="report", **k))     # may use the key reserved for the report
    window = window or day_bounds(date_str)
    material = list(material)
    if verify is None:
        verify = lambda src, rep: factcheck.verify_report(src, rep, chat=chat)  # noqa: E731
    max_tokens = 6000          # includes the model's reasoning tokens
    history = []               # problems of each failed draft; only the last two are shown to the model
    feedback = []
    round_no, failed = 0, 0
    last = Incomplete("no attempt")
    while max_rounds is None or round_no < max_rounds:
        round_no += 1
        tags = sorted({m["tag"] for m in material})
        source = story_source(material)
        prompt = _prompt(material, date_str, window)
        if feedback:
            prompt += ("\n\nYour previous draft was rejected. Fix ALL of this and write the COMPLETE newsletter again, "
                       "covering every story, using only facts that are in the stories above:\n"
                       + "\n".join(f"- {x}" for x in feedback[-12:])
                       + f"\nFinish with {END_MARKER}.")
        try:
            res = chat(prompt, max_tokens, temperature=_temperature(failed + 1))
        except (llm.AllKeysExhausted, llm.NoValidKeys) as e:
            round_no -= 1                                    # not the draft's fault: does not count as a round
            ready = getattr(e, "next_ready_at", None)
            wait = max(5, min(wait_cap, (ready - time.time()) if ready else wait_cap))
            sleep(wait)
            continue
        except llm.LLMError as e:
            last = Incomplete(f"model error: {str(e)[:150]}")
            failed += 1
            if on_round:
                on_round(round_no, str(last), len(material))
            sleep(min(5, wait_cap))
            continue
        problems = []
        try:
            raw = strip_end_marker(res.text, res.finish_reason)
            report = parse_report(raw, date_str, tags, [m['tag'] for m in material])
            check_newsletter(report, len(material))
            assert set(report) == REPORT_KEYS
            found = verify(source, report)
            if not found:
                return report
            raise Unsupported(found)
        except Unsupported as e:
            problems = [f"NOT supported by the stories: {x}" for x in e.problems[:10]]
            last = Incomplete("newsletter failed the fact-check: " + "; ".join(e.problems[:3])[:300])
        except (llm.AllKeysExhausted, llm.NoValidKeys) as e:   # the fact-check call ran out of keys
            round_no -= 1
            ready = getattr(e, "next_ready_at", None)
            sleep(max(5, min(wait_cap, (ready - time.time()) if ready else wait_cap)))
            continue
        except llm.LLMError as e:
            last = Incomplete(f"model error during the fact-check: {str(e)[:150]}")
            sleep(min(5, wait_cap))
        except Incomplete as e:
            last = e
            problems = [str(e)]
            if res.finish_reason == "length":
                max_tokens = 8000
        failed += 1
        history.append(problems)
        feedback = [coach(x) for p in history[-2:] for x in p]
        if failed >= 4 and failed % 4 == 0 and len(material) > MIN_STORIES:
            dropped = material.pop()                                              # material is ranked: last = least important
            if on_round:
                on_round(round_no, f"dropping the least important story to make it easier: {dropped['title'][:60]}", len(material))
        if on_round:
            on_round(round_no, str(last), len(material))
    raise last


def coach(problem):
    """Turns a bare rejection reason into an instruction the model can act on."""
    p = str(problem)
    m = re.search(r"numbers not in the source: ([^;]+)", p)
    if m:
        return (p + f"  -> DELETE these numbers from the newsletter: {m.group(1).strip()}. Rephrase without them. "
                "Use only numbers written exactly the same way in the stories; do not round, convert, add up or "
                "turn words into digits.")
    m = re.search(r"(lead story|story '[^']*') is (\d+) words", p)
    if m:
        return p + ("  -> Write MORE: the lead needs 200-320 words (4 solid paragraphs of detail from STORY 1)."
                    if m.group(1) == "lead story" else "  -> Keep every story inside its word range (60-130 words).")
    return p


# -------------------------------------------------------------- scheduler
REPORT_EVERY_HOURS = 24        # the 24-hour check: this long (+1 h) with nothing written triggers a catch-up report
DEFAULT_EDITION_HOUR, DEFAULT_EDITION_MINUTE, DEFAULT_LEAD_MINUTES = 13, 0, 30
CHECK_EVERY_SECONDS = 3600     # the report loop wakes at least this often
PENDING_CHECK_SECONDS = 300    # ...and this often while a report is due but there are too few stories yet
ERROR_RETRY_SECONDS = 60       # ...and this often after an error


def last_written(runs_col):
    """datetime (UTC) when the newest report was written, or None."""
    last = runs_col.find_one({}, sort=[("writtenAt", -1)])
    t = (last or {}).get("writtenAt")
    if not t:
        return None
    try:
        return datetime.fromisoformat(t.replace("Z", "+00:00"))
    except ValueError:
        return None


class ReportScheduler:
    """Owns the question "is a report due, and if so, write it until it exists".

      * Edition for UTC date D is due at D 12:30 UTC (edition time 13:00 minus 30 min lead). Fixed: it does NOT
        depend on when the previous report happened to be written.
      * Catch-up: if the latest deadline passed and nothing was written since, it is due now (date = that edition).
        24-hour check: nothing written for 25h -> today's edition is due now. Never written one: due now.
      * tick() checks that. When a report is due it writes it and DOES NOT RETURN until it is stored:
        corrected rewrites, no back-off. Only a missing API key makes it wait, a few seconds at a time.
      * ReportLoop (below) calls tick() on its own thread: at start, then every hour (sooner near a deadline)."""

    def __init__(self, storage, monitor, settings, clock=lambda: datetime.now(timezone.utc), chat=None, sleep=time.sleep):
        self.storage, self.monitor, self.s, self.clock, self.chat, self.sleep = storage, monitor, settings, clock, chat, sleep
        self.pending = False                       # due, but not enough stories yet: check again soon
        self._wait_emitted = None
        ensure_reports_collection(storage.db)
        self.col = storage.db["reports"]
        self.runs = storage.db["reportRuns"]       # when each report was written and which window it covered

    def _emit(self, kind, message, level="info", **data):
        """Report events go to the dashboard (Live activity AND the Midnight Reports page) and to the terminal."""
        print(f"  \u2605 [report] {message}")
        self.monitor.emit(kind, message, level=level, **data)

    def last_run(self):
        return self.runs.find_one({}, sort=[("writtenAt", -1)]) or {}

    def existing_dates(self):
        return {d["date"] for d in self.col.find({}, {"date": 1})}

    def every_hours(self):
        return self.s.get("every_hours", REPORT_EVERY_HOURS)

    # -- the fixed schedule
    def edition_time(self, day):
        """When the edition for UTC date `day` (a date) is published: 13:00 UTC by default."""
        return datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(
            hours=self.s.get("hour", DEFAULT_EDITION_HOUR), minutes=self.s.get("minute", DEFAULT_EDITION_MINUTE))

    def deadline(self, day):
        """When writing the edition for `day` must start so it is out before the edition time (12:30 UTC by default)."""
        return self.edition_time(day) - timedelta(minutes=self.s.get("lead_minutes", DEFAULT_LEAD_MINUTES))

    def latest_edition_day(self, now):
        """The newest edition date whose deadline has already passed."""
        d = now.date()
        for cand in (d + timedelta(days=1), d, d - timedelta(days=1), d - timedelta(days=2)):
            if self.deadline(cand) <= now:
                return cand
        return d - timedelta(days=2)

    def has_edition(self, date_str):
        return bool(self.col.find_one({"date": date_str}, {"_id": 1}) or self.runs.find_one({"date": date_str}, {"_id": 1}))

    def due_target(self, now=None):
        """None when nothing is due, else (edition_date_str, deadline_datetime_or_None, reason)."""
        now = now or self.clock()
        t = last_written(self.runs)
        if t is None:
            return now.strftime("%Y-%m-%d"), None, "first"                         # never written one
        day = self.latest_edition_day(now)
        ds = day.strftime("%Y-%m-%d")
        if t < self.deadline(day) and not self.has_edition(ds):
            return ds, self.deadline(day), "scheduled" if day == now.date() else "catch-up"   # a deadline passed, nothing since
        today = now.strftime("%Y-%m-%d")
        if now - t >= timedelta(hours=self.every_hours() + 1) and not self.has_edition(today):
            return today, None, "safety"                                            # 24-hour check: a whole day with nothing
        return None

    def is_due(self, now=None):
        return self.due_target(now) is not None

    def next_deadline(self, now=None):
        """The next time a report is due: now if one is due already, else the next unwritten edition's deadline."""
        now = now or self.clock()
        if self.is_due(now):
            return now, now.strftime("%Y-%m-%d")
        for k in range(0, 4):
            day = now.date() + timedelta(days=k)
            if self.deadline(day) > now and not self.has_edition(day.strftime("%Y-%m-%d")):
                return self.deadline(day), day.strftime("%Y-%m-%d")
        day = now.date() + timedelta(days=1)
        return self.deadline(day), day.strftime("%Y-%m-%d")

    def seconds_until_next(self, now=None):
        now = now or self.clock()
        return max(1.0, (self.next_deadline(now)[0] - now).total_seconds())

    def next_info(self):
        last = self.last_run()
        nxt, nxt_date = self.next_deadline()
        edition = self.edition_time(datetime.strptime(nxt_date, "%Y-%m-%d").date())
        return {"nextReportAt": iso(nxt), "nextReportDate": nxt_date, "nextReportEditionTime": iso(edition),
                "lastReportWrittenAt": last.get("writtenAt"), "lastReportDate": last.get("date"),
                "lastReportLate": last.get("late"), "lastReportLateMinutes": last.get("lateByMinutes"),
                "reportEveryHours": self.every_hours()}

    def tick(self):
        """Returns the date published, or None (not due yet, or too few stories to write one honestly)."""
        now = self.clock()
        target = self.due_target(now)
        if target is None:
            self.pending = False
            return None
        date, due_at, reason = target
        try:
            headlines.refresh_headlines(self.storage, now=now)   # fresh importance weights first
        except Exception:  # noqa: BLE001 - ranking trouble must not block the newsletter
            pass
        window = report_window(self.runs, now)
        total, material = gather_material(self.storage, window, self.s.get("max_stories", 12))
        if len(material) < MIN_STORIES:
            self.pending = True
            key = now.strftime("%Y-%m-%dT%H")
            if self._wait_emitted != key:             # one line per hour, not one per check
                self._wait_emitted = key
                self._emit("report_deferred", f"Midnight Report is due but only {total} stor{'y' if total == 1 else 'ies'} "
                           f"written since {window[0][:16]}: need at least {MIN_STORIES}. Checking again in "
                           f"{PENDING_CHECK_SECONDS // 60} min")
            return None
        self.pending = False
        late_min = max(0, int((now - due_at).total_seconds() // 60)) if due_at else 0
        late = late_min > 15
        self._emit("report_writing", f"Writing the Midnight Report for {date} ({reason}): the {len(material)} most important of "
                   f"{total} stories written since the last report ({window[0][:16]} to {window[1][:16]} UTC)"
                   + (f". It is {late_min} min past its {due_at.strftime('%H:%M')} UTC start" if late else ""), late=late)

        def on_round(n, why, n_stories):
            self._emit("report_retry", f"Midnight Report draft {n} rejected ({why[:160]}). Correcting and writing "
                       f"it again now ({n_stories} stories)", level="warn")

        report = write_report(material, date, self.chat, window=window, on_round=on_round, sleep=self.sleep)
        try:
            self.col.insert_one(dict(report))
        except DuplicateKeyError:
            # An edition for this date already exists (stored by someone else, or the run row was lost): keep it
            # and record the run so the same edition is not written twice.
            self._emit("report_deferred", f"A Midnight Report for {date} already exists; keeping it", level="warn")
        self._record_run(date, window, total, material, due_at or now, late, late_min)
        self._emit("report_published", f"Midnight Report for {date} published: {report['title'][:90]}",
                   date=date, sections=len(report["sections"]), late=late)
        return date

    def _record_run(self, date, window, total, material, scheduled_for, late, late_min):
        try:
            self.runs.insert_one({"date": date, "windowStart": window[0], "windowEnd": window[1],
                                  "writtenAt": iso(self.clock()), "articlesInWindow": total,
                                  "storyIds": [m["id"] for m in material],
                                  "scheduledFor": iso(scheduled_for), "late": late,
                                  "lateByMinutes": late_min})
        except Exception:  # noqa: BLE001 - the report is already stored; a missing run row only widens the next window
            pass


class ReportLoop:
    """The report's own thread. Independent of the article loop, so an article pause, a key cool-down or a slow
    feed can never hold it up.  Wakes at start and then every CHECK_EVERY_SECONDS (sooner if the next deadline is
    nearer, so it starts on the dot at 12:30 UTC; every PENDING_CHECK_SECONDS while a report is due but the
    stories are not there yet; after ERROR_RETRY_SECONDS following an error) and writes the report when due."""

    def __init__(self, scheduler, stop=None, sleep=time.sleep):
        self.sched, self.sleep = scheduler, sleep
        self.stop = stop or threading.Event()
        self.thread = None

    def run_once(self):
        """One wake-up. Returns seconds to sleep before the next one."""
        try:
            self.sched.tick()
        except Exception as e:  # noqa: BLE001 - database trouble etc.: say so, look again in a minute
            self.sched._emit("report_failed", f"Report loop error: {type(e).__name__}: {str(e)[:150]}. Trying again in 1 min",
                             level="error")
            return ERROR_RETRY_SECONDS
        if self.sched.pending:
            return PENDING_CHECK_SECONDS
        try:
            return min(CHECK_EVERY_SECONDS, self.sched.seconds_until_next())
        except Exception:  # noqa: BLE001
            return CHECK_EVERY_SECONDS

    def run(self):
        while not self.stop.is_set():
            wait = self.run_once()
            end = time.monotonic() + wait
            while not self.stop.is_set() and time.monotonic() < end:
                self.sleep(min(5, max(0.0, end - time.monotonic())))

    def start(self):
        self.thread = threading.Thread(target=self.run, name="midnight-report", daemon=True)
        self.thread.start()
        return self.thread
