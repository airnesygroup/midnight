"""
Writes Midnight's own blog post about a trend with Groq.

Same discipline as rewriter.py: plain delimited text (not JSON), the reply must
finish normally AND end with ===END===, and every structural check in
quality.py must pass, or the post is never published. The model may also answer
SKIP: <reason> when the material is not safe/appropriate to write about; that
trend is then recorded as skipped, never published.
"""

import random
import re

import llm
import realcheck
from quality import END_MARKER, Incomplete, check_article_text, strip_end_marker
from rewriter import _clean_body_html
from trend_schema import HASHTAG_VOCAB, clean_hashtags


class Unsuitable(Exception):
    """The writer declined this trend (e.g. it would need unverified claims about a private person)."""


VOICES = [
    {"name": "Curious Explainer", "tone": "a curious, plain-spoken blogger who explains what is going on and why everyone suddenly cares",
     "formatting": "short paragraphs, **bold** for the key facts and one <h3> subheading or two"},
    {"name": "Group-Chat Insider", "tone": "a warm, quick-witted writer who sounds like the friend who always knows what is trending",
     "formatting": "conversational short paragraphs, light *italics* for asides, no slang that will age badly"},
    {"name": "Clear-Eyed Observer", "tone": "a calm, clear-eyed observer who separates what is confirmed from what is just buzz",
     "formatting": "tight paragraphs, a short bulleted list of what is confirmed, an <h3> for what is still unclear"},
]


WRITER_TEMPERATURE = 0.4   # was 0.8: invented details come from high temperature


def pick_voice():
    return random.choice(VOICES)


def _length(chars):
    if chars < 900:
        return ("The material is thin. Write a short post of 3 or 4 paragraphs and do not pad it.", 1000, 500)
    if chars < 3500:
        return ("Write a full blog post of about 5 to 7 paragraphs covering everything the material supports.", 1700, 900)
    return ("The material is rich. Write a detailed blog post of 7 to 10 paragraphs; use <h3> subheadings.", 2600, 1500)


def build_prompt(trend, material, voice):
    instr, _, _ = _length(len(material["text"]))
    geos = ", ".join(trend.get("geos") or [trend.get("geo", "")])
    names = ", ".join(dict.fromkeys(s["name"] for s in material["sources"]))
    return f"""You are {voice['tone']}. Write an ORIGINAL blog post for the "Midnight Trends" section
about the search trend below. Midnight Trends explains what is going viral or trending around the world.

Trend: {trend['query']}
Trending in: {geos}
Google's search-volume floor: {trend.get('trafficLabel') or 'unknown'}
Sources we read: {names}

Material (what the sources say; the ONLY facts you may use):
{material['text']}

STRICT FACTUAL RULES. A fact-checker will compare your post to the material line by line and reject it
if it breaks any of these:
- Every name, role, number, date, place, quotation and claim must come from the material (or from the
  Trend / Trending in / search-volume lines above). If the material does not say it, leave it out, even
  if you believe it is true. Do not add background, history, relationships, motives or causes the
  material does not state. Quotation marks only for words that appear word for word in the material.
- Your voice shapes tone only. Any opinion must be framed as the writer's view and assert no new fact.
- If the sources disagree or are unclear, say so. If the material is thin, write less; never fill gaps.

Rules
- Write entirely in your own words. Never copy sentences from the material.
- Explain what the trend is, why people are searching for it now, what is actually known, and what is not.
- Mention the outlets you drew on by name in the text (for example "according to ESPN"). No links.
- Be careful with real people: no speculation about private individuals, health, crime, death or legal
  matters beyond what the material states plainly. No sexual or explicit content.
- If the material cannot be written about safely or honestly under these rules, reply with ONE line only:
  SKIP: <short reason>

{realcheck.INSTRUCTION}

{instr}
Formatting: {voice['formatting']}. In the body use only these HTML tags: <p>, <b>, <i>, <strong>, <em>,
<h3>, <ul>, <li>. Do not use markdown syntax. No <html>/<body> wrappers. Finish every paragraph and end
with a complete concluding sentence.

HASHTAGS are 2 to 5 topic tags, comma separated, no # sign. Pick the best 1 to 3 from this list
({', '.join(HASHTAG_VOCAB)}) and you may add up to 2 short specific tags of your own (one word each,
for example a team, person, place or event name).

Respond in EXACTLY this format and nothing else, no preamble, no code fences:

{realcheck.FORMAT_LINE}
TITLE: <the post title, one line, a real headline, not just the search term>
EXCERPT: <one complete sentence teaser, one line>
SUMMARY1: <key takeaway 1, one complete sentence>
SUMMARY2: <key takeaway 2, one complete sentence>
SUMMARY3: <key takeaway 3, one complete sentence>
HASHTAGS: <tag1, tag2, tag3>
BODY:
<the full HTML body, can span many lines>
{END_MARKER}"""


def parse(raw):
    """-> (title, excerpt, summary[3], hashtags_raw[list], html_body). Raises Incomplete / Unsuitable."""
    head = raw.strip().splitlines()[0] if raw.strip() else ""
    m = re.match(r"^\s*SKIP:\s*(.*)$", head, re.I)
    if m:
        raise Unsuitable(m.group(1)[:200] or "writer declined")
    t = re.search(r"^TITLE:\s*(.+)$", raw, re.M)
    e = re.search(r"^EXCERPT:\s*(.+)$", raw, re.M)
    h = re.search(r"^HASHTAGS:\s*(.+)$", raw, re.M)
    b = re.search(r"^BODY:\s*\n?(.*)", raw, re.M | re.S)
    summary = [x.group(1).strip() for x in re.finditer(r"^SUMMARY\d:\s*(.+)$", raw, re.M)]
    if not (t and e and b and h):
        raise Incomplete("reply is missing TITLE / EXCERPT / HASHTAGS / BODY")
    return (t.group(1).strip(), e.group(1).strip(), summary,
            [x.strip() for x in h.group(1).split(",") if x.strip()], _clean_body_html(b.group(1).strip()))


def write_trend(trend, material, voice=None, chat=None, feedback=None):
    """-> {'title','excerpt','summary','html_body','hashtags','voice'}."""
    chat = chat or llm.chat
    voice = voice or pick_voice()
    _, max_tokens, min_body = _length(len(material["text"]))
    prompt = build_prompt(trend, material, voice)
    if feedback:
        prompt += ("\n\nA fact-check of your previous draft found these statements are NOT supported by the "
                   "material:\n" + "\n".join(f"- {f}" for f in feedback[:10]) +
                   "\nWrite the post again WITHOUT them. Do not replace them with other details the material "
                   "does not contain.")
    import config
    last = Incomplete("no attempt made")
    base_prompt = prompt
    temperature = min(WRITER_TEMPERATURE, 0.3) if feedback else WRITER_TEMPERATURE
    for _ in range(config.retry_settings()["write_tries"]):
        res = chat(prompt, max_tokens, temperature=temperature)
        try:
            if re.match(r"^\s*SKIP:", res.text or "", re.I):
                raise Unsuitable((res.text or "")[5:].strip()[:200] or "writer declined")
            try:
                realcheck.require_flag(res.text)
            except realcheck.NotNews as nn:
                raise Unsuitable(f"not a real news article: {nn}") from nn
            raw = strip_end_marker(res.text, res.finish_reason)
            title, excerpt, summary, tags, html = parse(raw)
            check_article_text(title, excerpt, summary, html, min_body)
        except Incomplete as e:
            last = e
            if res.finish_reason == "length":
                max_tokens = min(int(max_tokens * 1.6), 6000)
            prompt = base_prompt + ("\n\nYour previous attempt was incomplete or malformed "
                                    f"({str(e)[:120]}). Write the COMPLETE post this time and finish with the {END_MARKER} line.")
            temperature = min(temperature, 0.3)
            continue
        return {"title": title, "excerpt": excerpt, "summary": summary, "html_body": html,
                "hashtags": clean_hashtags(tags, fallback_from=trend["query"]), "voice": voice["name"]}
    raise last
