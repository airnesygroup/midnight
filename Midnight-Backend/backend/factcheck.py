"""
Hallucination guard. A rewritten article is only published if it is SUPPORTED by
the source text the writer was given.

Two layers, run in this order:

  1. Local grounding check (free, deterministic, always on). Everything in the
     article that can be checked mechanically must appear in the source:
       * every number / score / year,
       * every direct quotation (word for word),
       * every proper noun (names of people, clubs, places, organisations).
     Numbers and quotes are hard failures. Names missing from the source are a
     hard failure when there are several of them, or when the LLM check is off;
     one or two are passed to the LLM check as specific suspects.

  2. LLM fact-check (one extra, cheap call; FACTCHECK_LLM=off disables it). A
     second pass reads the SOURCE and the ARTICLE and lists every statement the
     source does not support: invented relationships, backstory, motives, roles.
     These are the hallucinations a word-matcher cannot see.
     If this call's reply is cut off or malformed the article is NOT published
     (fail closed): "could not verify" is treated as "not verified".

Both layers compare against the same text the writer saw (the first
SOURCE_CHARS characters of the scraped article plus its headline).
"""

import re
import unicodedata

import config
import llm
from quality import Incomplete, strip_end_marker, plain, END_MARKER

SOURCE_CHARS = 8000          # must match what rewriter._build_prompt shows the writer
TREND_SOFT_NAMES = 6         # trend sources are often not English: names get transliterated, the LLM check decides
REPORT_VERIFY_TOKENS = 3000    # a 12-story newsletter is long; 900 was cut off
REPORT_SOFT_NAMES = 4        # a 12-story newsletter has more names; same idea, a little more room
SOFT_NAME_LIMIT = 2          # up to this many unseen names go to the LLM check instead of failing outright
VERIFY_MAX_TOKENS = 1500     # includes the model's hidden reasoning; 500 was often cut off


class Ungrounded(Exception):
    """The article contains statements the source does not support."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("; ".join(self.problems[:4]))


# ---------------------------------------------------------------- text helpers
def _fold(t):
    """Lower-case, strip accents, unify quotes/dashes/whitespace."""
    t = unicodedata.normalize("NFKD", t or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = (t.replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
          .replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-").replace("\u2010", "-")
          .replace("\u2212", "-").replace("\u00a0", " "))
    return re.sub(r"\s+", " ", t).strip().lower()


_WORD_NUM = {w: str(i) for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen twenty".split())}
_WORD_NUM.update({"thirty": "30", "forty": "40", "fifty": "50", "sixty": "60", "seventy": "70",
                  "eighty": "80", "ninety": "90", "hundred": "100", "thousand": "1000"})
# 20,000 / 20.000 / 20 000 / 1,234,567 (thousands groups, any locale) or a plain number with decimals
_NUM_RE = re.compile(r"\d{1,3}(?:[ \u00a0\u202f.,]\d{3})+(?!\d)|\d+(?:[.,]\d+)*")
_SUFFIX_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s?([KkMmBb])\b")
_SUFFIX_X = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}


def _variants(tok):
    """Every way a written number can be read, so 20,000 / 20.000 / 20 000 all match each other."""
    out = {tok.replace(",", "").rstrip(".")}
    digits = re.sub(r"[ \u00a0\u202f.,]", "", tok)
    if re.fullmatch(r"\d{1,3}(?:[ \u00a0\u202f.,]\d{3})+", tok):
        out.add(digits)                                   # read as thousands groups
        if re.search(r"[ \u00a0\u202f]", tok):
            out |= set(re.findall(r"\d+", tok))           # a space may just separate two numbers ("5 100 people")
    out.add(tok.replace(",", "."))                        # decimal comma
    return out


def _number_tokens(text):
    return [_variants(m) for m in _NUM_RE.findall(text or "")]


def _numbers(text):
    out = set()
    for v in _number_tokens(text):
        out |= v
    return out


def _source_numbers(text):
    nums = _numbers(text)
    for m in _SUFFIX_RE.finditer(text or ""):             # "5K+" / "2M" -> 5000 / 2000000
        try:
            val = float(m.group(1).replace(",", ".")) * _SUFFIX_X[m.group(2).lower()]
            nums.add(str(int(val)))
        except ValueError:
            pass
    for w in re.findall(r"[a-z]+", _fold(text)):
        if w in _WORD_NUM:
            nums.add(_WORD_NUM[w])
    return nums


def _loose(t):
    """Words only: punctuation, dashes and spacing ignored. A quotation must still match WORD FOR WORD,
    but a full stop where the source has a comma (or a hyphen where it has a dash) is not a fabrication."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9' ]+", " ", _fold(t))).strip()


_ELLIPSIS = re.compile(r"\[?(?:\.{3}|\u2026)\]?")


_QUOTE_RE = re.compile(r'"([^"]{12,}?)"')


def _quotes(text):
    return [q.strip() for q in _QUOTE_RE.findall(_fold(text)) if len(q.split()) >= 3]


_PROPER_RE = re.compile(r"[A-Z][A-Za-z']{2,}")
_STOP_PROPER = {
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "june", "july", "august", "september",
    "october", "november", "december", "mr", "mrs", "ms", "dr", "sir", "the",
}


def _proper_nouns(text):
    """Capitalised words that are NOT the first word of a sentence or quotation."""
    found = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", text or ""):
        lead = len(sentence) - len(sentence.lstrip())
        for m in _PROPER_RE.finditer(sentence):
            if m.start() == lead:
                continue    # sentence-initial: the capital tells us nothing
            if sentence[:m.start()].rstrip().endswith((":", '"', "\u201c")):
                continue    # start of a quotation / clause
            w = re.sub(r"'s?$", "", m.group(0))
            if len(w) >= 3 and _fold(w) not in _STOP_PROPER:
                found.append(w)
    return found


def _known(word, source_tokens):
    w = _fold(word)
    if w in source_tokens:
        return True
    if w.endswith("s") and w[:-1] in source_tokens:
        return True
    for s in source_tokens:
        if len(s) >= 4 and len(w) >= 4 and (s.startswith(w) or (w.startswith(s) and len(s) >= len(w) - 3)):
            return True
    return False


# --------------------------------------------------------------- strictness
# strict   : every unsupported number, quotation or (several) names blocks the article.
# balanced : numbers block. A quotation that is not word for word is NOT a reason to lose the article: its
#            quotation marks are removed (it then reads as the writer's paraphrase, which the LLM check judges).
#            Names only block when many are unseen (translation / transliteration makes a few normal).
# light    : numbers block; quotes are unquoted; names are ignored; no LLM call.
NAME_LIMIT = {"strict": None, "balanced": 5, "light": 10 ** 6}      # None = the caller's soft limit
_QUOTED = re.compile(r'[\u201c"]([^\u201c\u201d"]{12,}?)[\u201d"]')


def _unquote_ungrounded(text, src_loose):
    """Removes the quotation marks around quotes the source does not contain word for word."""
    def fix(m):
        pieces = [x for x in _ELLIPSIS.split(m.group(1)) if len(_loose(x).split()) >= 3]
        return m.group(0) if all(_loose(x) in src_loose for x in pieces) else m.group(1)
    return _QUOTED.sub(fix, text or "")


def repair_quotes(post, src_loose):
    """In place: unquote every ungrounded quotation in the post. Returns how many fields changed."""
    changed = 0
    for key in ("title", "excerpt", "html_body"):
        new = _unquote_ungrounded(post.get(key), src_loose)
        if new != post.get(key):
            post[key], changed = new, changed + 1
    if post.get("summary"):
        new = [_unquote_ungrounded(x, src_loose) for x in post["summary"]]
        if new != post["summary"]:
            post["summary"], changed = new, changed + 1
    return changed


# ------------------------------------------------------------ layer 1: local
def grounding_problems(source_title, source_text, post, limit=SOURCE_CHARS):
    """Returns (hard_problems, suspect_names). Both are lists of human-readable strings / names.
    `limit` must equal how much source text the writer was shown."""
    src = f"{source_title or ''}\n{(source_text or '')[:limit]}"
    src_fold = _fold(src)
    src_nums = _source_numbers(src)
    src_tokens = set(re.findall(r"[a-z']+", src_fold))
    src_tokens |= {t.rstrip("'s") for t in src_tokens}

    body_html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", post["html_body"], flags=re.S | re.I)
    paragraphs = [plain(p) for p in re.findall(r"<(?:p|li|blockquote)[^>]*>(.*?)</(?:p|li|blockquote)>", body_html, flags=re.S)]
    headings = [plain(p) for p in re.findall(r"<h3[^>]*>(.*?)</h3>", body_html, flags=re.S)]   # Title Case: numbers/quotes only
    fields = [post["title"], post["excerpt"], *post["summary"], *paragraphs, *headings]

    hard = []
    bad = {}
    for f in fields:
        for v in _number_tokens(f):
            if not (v & src_nums):                         # no reading of this number appears in the source
                bad[max(v, key=lambda x: (x.isdigit(), len(x)))] = True
    bad_nums = sorted(bad)
    if bad_nums:
        hard.append("numbers not in the source: " + ", ".join(bad_nums[:8]))

    src_loose = _loose(src)
    quotes = [q for f in fields for q in _quotes(f)]
    bad_quotes = []
    for q in dict.fromkeys(quotes):
        # a quote with an ellipsis is several pieces; each piece must be in the source word for word
        pieces = [x for x in _ELLIPSIS.split(q) if len(_loose(x).split()) >= 3]
        if any(_loose(x) not in src_loose for x in pieces):
            bad_quotes.append(q)
    for q in bad_quotes[:3]:
        hard.append(f'quotation not word-for-word in the source: "{q[:90]}"')

    names = []
    for f in [post["excerpt"], *post["summary"], *paragraphs]:      # headline and <h3> subheadings are Title Case: skip them
        names += _proper_nouns(f)
    unseen = list(dict.fromkeys(n for n in names if not _known(n, src_tokens)))
    return hard, unseen


# -------------------------------------------------------------- layer 2: LLM
def _verify_prompt(source_title, source_text, post, suspects, limit=SOURCE_CHARS, style_note=""):
    article = "\n".join([post["title"], post["excerpt"], *post["summary"], plain(post["html_body"])])
    sus = ""
    if suspects:
        sus = ("\nThese names appear in the ARTICLE but nowhere in the SOURCE, so check each one "
               "carefully: " + ", ".join(suspects[:12]) + "\n")
    return f"""You are a strict fact-checker. Compare the ARTICLE to the SOURCE and find every
statement in the ARTICLE that the SOURCE does not support.

A statement is SUPPORTED only if the SOURCE states it, or it follows directly from what the SOURCE
states. It is UNSUPPORTED if it adds any person, role, number, date, place, quotation, cause,
motive, relationship, history or background that the SOURCE does not contain, EVEN IF it might be
true in the real world. Do not use your own knowledge to excuse anything. Ignore differences in
wording and style. Ignore opinions framed as the writer's own view that assert no new fact.
{style_note}{sus}
SOURCE TITLE: {source_title}
SOURCE:
{(source_text or '')[:limit]}

ARTICLE:
{article}

Reply in EXACTLY this format and nothing else:

VERDICT: <PASS or FAIL>
UNSUPPORTED:
- <the unsupported statement, quoted or closely paraphrased from the ARTICLE, one per line>
(write "- none" if every statement is supported)
{END_MARKER}"""


def _parse_verdict(raw):
    verdict = re.search(r"^VERDICT:\s*(PASS|FAIL)\s*$", raw, re.M | re.I)
    block = re.search(r"^UNSUPPORTED:\s*\n(.*)", raw, re.M | re.S)
    if not verdict or not block:
        raise Incomplete("fact-check reply was malformed, so the article could not be verified")
    items = [re.sub(r"^[-*\u2022]\s*", "", ln).strip() for ln in block.group(1).splitlines() if ln.strip()]
    items = [i for i in items if i and i.lower().rstrip(".") != "none"]
    if verdict.group(1).upper() == "FAIL" and not items:
        items = ["the fact-checker rejected the article without naming the claim"]
    return items


def llm_problems(source_title, source_text, post, suspects=(), chat=None, limit=SOURCE_CHARS, style_note="",
                 max_tokens=VERIFY_MAX_TOKENS):
    chat = chat or llm.chat
    prompt = _verify_prompt(source_title, source_text, post, list(suspects), limit, style_note)
    last = Incomplete("no attempt")
    for budget in (max_tokens, max_tokens * 2):          # a cut-off answer is asked again once with double the room
        res = chat(prompt, budget, temperature=0)
        try:
            return _parse_verdict(strip_end_marker(res.text, res.finish_reason))
        except Incomplete as e:
            last = e
            if res.finish_reason != "length":
                break                                    # malformed, not truncated: more room will not help
    raise last


# ------------------------------------------------------------------- the gate
def verify(entry, post, chat=None, use_llm=None, limit=SOURCE_CHARS, soft_name_limit=SOFT_NAME_LIMIT,
           style_note="", max_tokens=VERIFY_MAX_TOKENS, mode=None):
    """Returns a list of problems (empty = the article is supported by its source).
    Raises Incomplete if the LLM check could not complete, and llm.* errors for API trouble."""
    st = config.factcheck_settings()
    use_llm = st["llm"] if use_llm is None else use_llm
    mode = mode or st["mode"]
    title, text = entry.get("title", ""), entry.get("text", "")
    hard, unseen = grounding_problems(title, text, post, limit)
    if mode != "strict":
        # quotes are repaired, not fatal; the numbers/other problems still decide
        if any(h.startswith("quotation") for h in hard):
            src_loose = _loose(f"{title or ''}\n{(text or '')[:limit]}")
            repair_quotes(post, src_loose)
        hard = [h for h in hard if not h.startswith("quotation")]
    problems = list(hard)
    name_limit = NAME_LIMIT[mode] or soft_name_limit
    if unseen and len(unseen) > name_limit:
        problems.append("names not in the source: " + ", ".join(unseen[:8]))
    elif unseen and not use_llm and mode == "strict":
        problems.append("names not in the source: " + ", ".join(unseen[:8]))
    if problems or not use_llm:
        return problems         # no need to spend an LLM call on an article that already fails
    try:
        return llm_problems(title, text, post, suspects=unseen, chat=chat, limit=limit, style_note=style_note,
                            max_tokens=max_tokens)
    except Incomplete as e:
        if mode == "strict":
            raise                                        # "could not verify" = "not verified"
        # balanced / light: the free local checks (numbers, quotes, names) already passed; do not throw the
        # article away only because the second model's answer would not finish.
        print(f"  ? fact-check call could not complete ({str(e)[:80]}); kept on the local check only")
        return []


# ----------------------------------------------------- trends and the newsletter
def _as_post(title, excerpt, summary, paragraphs):
    return {"title": title, "excerpt": excerpt, "summary": list(summary),
            "html_body": "".join(f"<p>{p}</p>" for p in paragraphs)}


def verify_trend(trend, material, post, chat=None, use_llm=None):
    """A Midnight Trends post must be supported by the material the writer was shown (the page texts
    PLUS the facts in the prompt header: the countries and the search-volume floor)."""
    geos = ", ".join(trend.get("geos") or [trend.get("geo", "")])
    header = (f"Trend: {trend['query']}\nTrending in: {geos}\n"
              f"Google's search-volume floor: {trend.get('trafficLabel') or 'unknown'}\n"
              f"Sources we read: {', '.join(dict.fromkeys(s['name'] for s in material['sources']))}\n")
    text = header + material["text"]
    return verify({"title": trend["query"], "text": text}, post, chat=chat, use_llm=use_llm, limit=len(text) + 1,
                  soft_name_limit=TREND_SOFT_NAMES)


REPORT_STYLE_NOTE = ("This ARTICLE is a newsletter written in a witty, conversational voice. Jokes, wordplay, "
                     "figures of speech and friendly asides are fine as long as they assert no new fact. A "
                     "number, name, place, quotation, cause or outcome that the SOURCE does not contain is "
                     "UNSUPPORTED even when it is phrased as a joke. Forward-looking lines (what to watch) must "
                     "only point at things the SOURCE says are scheduled, pending or unresolved.\n")


def verify_report(source_text, report, chat=None, use_llm=None):
    """The newsletter must be supported by the stories the editor was given (source_text = those stories,
    exactly as the writer saw them). Headlines are checked for numbers and quotations only (they are
    wordplay-friendly); every paragraph is checked for numbers, quotations, names and unsupported claims."""
    paragraphs = [report["introduction"], report["leadExcerpt"], *report["leadParagraphs"],
                  *[p for s in report["sections"] for p in s["paragraphs"]], report["lastWord"]]
    headlines = " | ".join([report["title"], report["leadTitle"], *[s["title"] for s in report["sections"]]])
    post = _as_post(headlines, paragraphs[0], [], paragraphs[1:])
    return verify({"title": "The day's stories", "text": source_text}, post, chat=chat, use_llm=use_llm,
                  limit=len(source_text) + 1, soft_name_limit=REPORT_SOFT_NAMES, style_note=REPORT_STYLE_NOTE,
                  max_tokens=REPORT_VERIFY_TOKENS)
