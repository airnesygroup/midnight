"""
Rewrites a scraped article into an original article with the Groq API.

Output is plain delimited text (not JSON, which broke on escaping), and the
reply must end with a ===END=== marker and a normal finish_reason. A reply
that was cut off (credits ran out, token limit, network) is REJECTED here and
never turns into an article. See quality.py for the full set of checks.
"""

import random
import re

import llm
from schema import SECTIONS
import realcheck
from quality import Incomplete, strip_end_marker, check_article_text, plain, END_MARKER

VOICES = [
    {
        "name": "Sharp & Skeptical",
        "tone": "a sharp, slightly skeptical tech analyst who questions hype and looks for the catch",
        "formatting": "uses **bold** for key claims and *italics* for asides or caveats",
    },
    {
        "name": "Enthusiast",
        "tone": "an enthusiastic early-adopter who gets genuinely excited about what's new",
        "formatting": "uses *italics* for excitement and occasional short punchy one-line paragraphs",
    },
    {
        "name": "Explainer",
        "tone": "a patient explainer writing for a smart reader who isn't a specialist",
        "formatting": "uses **bold** for defined terms and a numbered or bulleted breakdown",
    },
    {
        "name": "Dry & Witty",
        "tone": "a dry, witty industry observer who's seen a dozen hype cycles before",
        "formatting": "uses understated *italics* for the punchlines, minimal bold",
    },
    {
        "name": "Big Picture",
        "tone": "a big-picture thinker who connects this story to broader industry trends",
        "formatting": "uses **bold** for the trend statement and a closing italic takeaway line",
    },
]


WRITER_TEMPERATURE = 0.4   # was 0.9: high temperature is where invented details come from


def _section_menu():
    return "\n".join(f"  {s['slug']} — {s['name']}" + (f": {s['desc']}" if s.get("desc") else "") for s in SECTIONS)


def _parse_sections(raw: str):
    """The model's SECTIONS line as a list of raw picks (validated later by schema.resolve_sections)."""
    m = re.search(r"^SECTIONS:\s*(.+)$", raw, re.MULTILINE)
    return [x.strip() for x in re.split(r"[,;|]", m.group(1)) if x.strip()] if m else []


def pick_voice():
    return random.choice(VOICES)


def _length_spec(source_words: int):
    """Returns (instruction, max_tokens, min_body_chars) for the source length."""
    if source_words < 150:
        return (
            "The source is short. Write a comparably short post — a few "
            "paragraphs is fine. Do not pad it out to sound more substantial "
            "than the source material.",
            600, 200,
        )
    if source_words < 500:
        return (
            "Match the source's length and level of detail — write a "
            "full-length post that covers everything the source covers, "
            "not a condensed summary of it.",
            1400, 700,
        )
    return (
        "The source is long and detailed. Write a comparably long, "
        "detailed post that covers the material thoroughly — do not "
        "compress it into a short summary. Use multiple sections with "
        "<h3> subheadings if that suits the material.",
        2600, 1500,
    )


def _build_prompt(article, voice, length_instruction):
    source_text = (article["text"] or "")[:8000]
    return f"""You are {voice['tone']}. Write an ORIGINAL news article based ONLY on the source
article below. Use your own words and sentence structure; do not copy sentences verbatim.

STRICT FACTUAL RULES. A fact-checker will compare your article to the source line by line and
reject it if it breaks any of these:
- Every name, role, number, score, date, place, quotation and claim must come from the source
  material. If the source does not say it, leave it out, even if you believe it is true.
- Do not add background, history, relationships between people, motives or context that the
  source does not state.
- Do not put words in quotation marks unless they appear word for word in the source.
- Your voice shapes tone and emphasis only. Any opinion must be clearly framed as the writer's
  view and must not assert a new fact.
- If the source is thin, write a shorter article. Never fill gaps with invented detail.

Source title: {article['title']}
Source material:
{source_text}

Formatting style for this article: {voice['formatting']}. Inside the body, use
only these HTML tags: <p>, <b>, <i>, <strong>, <em>, <h3>, <ul>, <li>. Do not
use markdown syntax like ** or * — use the actual HTML tags instead. Do not
include <html>, <body>, or any wrapper tags. Finish every paragraph and end
the article with a complete concluding sentence.

{length_instruction}

IMPORTANCE scores how much this story matters to a general reader today, judged on the
source material only: 85-100 = major world-changing or market-moving event (war, election
result, big policy change, disaster, major market or tech shift); 60-84 = significant news
with wide impact; 35-59 = ordinary news of interest to some readers; 10-34 = minor,
niche, routine or feature material; 0-9 = trivial. Sports results, entertainment gossip,
lifestyle and product-review pieces are rarely above 40 unless something truly exceptional
happened. Be strict: most stories should score between 20 and 70.

{realcheck.INSTRUCTION}

SECTIONS: choose where this story belongs on the site, using ONLY the slugs below. Pick 1 to 3,
most relevant first. Add a second or third only if the story genuinely belongs there too. Judge
by what the story is ABOUT, not where it was published. Prefer the most specific section: a
football match is "sport", a chip launch is "tech". Use "world" only for international affairs
that fit no more specific section.
{_section_menu()}

Respond in EXACTLY this format and nothing else — no preamble, no code
fences, no commentary before or after:

{realcheck.FORMAT_LINE}
TITLE: <the article title, one line>
EXCERPT: <one complete sentence teaser, one line>
SUMMARY1: <key takeaway 1, one complete sentence>
SUMMARY2: <key takeaway 2, one complete sentence>
SUMMARY3: <key takeaway 3, one complete sentence>
IMPORTANCE: <a whole number from 0 to 100, nothing else on the line>
SECTIONS: <1 to 3 slugs from the list above, comma-separated, most relevant first>
BODY:
<the full HTML body, can span many lines>
{END_MARKER}"""


def _parse_response(raw: str):
    """Returns (title, excerpt, summary[3], html_body, importance); raises Incomplete."""
    title_m = re.search(r"^TITLE:\s*(.+)$", raw, re.MULTILINE)
    excerpt_m = re.search(r"^EXCERPT:\s*(.+)$", raw, re.MULTILINE)
    body_m = re.search(r"^BODY:\s*\n?(.*)", raw, re.MULTILINE | re.DOTALL)
    summary = [m.group(1).strip() for m in re.finditer(r"^SUMMARY\d:\s*(.+)$", raw, re.MULTILINE)]
    if not (title_m and excerpt_m and body_m):
        raise Incomplete("reply is missing TITLE / EXCERPT / BODY")
    imp_m = re.search(r"^IMPORTANCE:\s*(\d{1,3})\s*$", raw, re.MULTILINE)
    if not imp_m or int(imp_m.group(1)) > 100:
        raise Incomplete("reply is missing a valid IMPORTANCE score (0-100)")
    return (title_m.group(1).strip(), excerpt_m.group(1).strip(), summary,
            _clean_body_html(body_m.group(1).strip()), int(imp_m.group(1)))


def _clean_body_html(html: str) -> str:
    """
    Best-effort cleanup for when the model slips markdown into the HTML
    despite instructions not to. Converts **bold**, *italic*, and simple
    "* item" bullet lists into their HTML equivalents; leaves everything
    else alone.
    """
    html = html.strip()
    html = re.sub(r"^```(html)?|```$", "", html, flags=re.MULTILINE).strip()

    # Markdown bold/italic that slipped through -> real tags
    html = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", html)
    html = re.sub(r"(?<!<)\*(?!\*)(.+?)(?<!\*)\*(?!>)", r"<i>\1</i>", html)

    # Markdown bullet lines ("* item" / "- item") not already inside <li> ->
    # wrap consecutive bullet lines in <ul><li>...</li></ul>
    lines = html.split("\n")
    out, buf = [], []

    def flush():
        if buf:
            out.append("<ul>" + "".join(f"<li>{b}</li>" for b in buf) + "</ul>")
            buf.clear()

    for line in lines:
        m = re.match(r"^\s*[\*\-]\s+(.*)$", line)
        if m and "<li>" not in line:
            buf.append(m.group(1).strip())
        else:
            flush()
            out.append(line)
    flush()

    cleaned = "\n".join(out)
    # Collapse 3+ blank lines and drop any stray literal backslash-n text
    # (as opposed to real newlines) that sometimes leaks from bad escaping.
    cleaned = cleaned.replace("\\n", " ")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()



_BLOCK_RE = re.compile(r".*?(</p>|</h3>|</ul>)", re.DOTALL)


def _split_blocks(html: str):
    """Splits HTML into top-level blocks (paragraphs, headings, lists)."""
    blocks, pos = [], 0
    for m in _BLOCK_RE.finditer(html):
        blocks.append(html[pos:m.end()])
        pos = m.end()
    if pos < len(html) and html[pos:].strip():
        blocks.append(html[pos:])
    return [b for b in blocks if b.strip()]


def _interleave_images(html_body: str, images: list) -> str:
    """
    Spaces extra images through the body instead of dumping them all at the
    end. images[0] is the hero (stored as the article's `img`) — this only places images[1:], and only if
    there's enough body content to space them meaningfully.
    """
    extra = images[1:]
    if not extra:
        return html_body

    blocks = _split_blocks(html_body)
    if len(blocks) < 3:
        return html_body  # too short to space images without crowding

    step = max(2, len(blocks) // (len(extra) + 1))
    out, img_i = [], 0
    for idx, block in enumerate(blocks, start=1):
        out.append(block)
        is_last_block = idx == len(blocks)
        if img_i < len(extra) and idx % step == 0 and not is_last_block:
            out.append(f'<figure class="inline-img"><img src="{extra[img_i]}" alt=""></figure>')
            img_i += 1
    return "".join(out)


def rewrite_article(article: dict, voice: dict = None, chat=None, feedback=None) -> dict:
    """
    article: {"title", "url", "text", "images", "source"}
    feedback: list of statements a fact-check found unsupported by the source; the writer is told
    to rewrite without them.
    Returns: {"title", "excerpt", "summary", "html_body", "img", "source_url",
              "source_name", "voice", "importance", "sections"}
    Raises quality.Incomplete if no COMPLETE article could be produced, and
    llm.AllKeysExhausted / llm.NoValidKeys / llm.LLMError for API problems.
    """
    chat = chat or llm.chat
    voice = voice or pick_voice()
    source_words = len((article["text"] or "").split())
    length_instruction, max_tokens, min_body_chars = _length_spec(source_words)
    prompt = _build_prompt(article, voice, length_instruction)
    if feedback:
        prompt += ("\n\nA fact-check of your previous draft found these statements are NOT supported by "
                   "the source material:\n" + "\n".join(f"- {f}" for f in feedback[:10]) +
                   "\nWrite the article again WITHOUT them. Do not replace them with other details the "
                   "source does not contain.")

    import config
    last = Incomplete("no attempt made")
    base_prompt = prompt
    temperature = min(WRITER_TEMPERATURE, 0.3) if feedback else WRITER_TEMPERATURE     # a correction sticks to the facts
    for attempt in range(config.retry_settings()["write_tries"]):
        res = chat(prompt, max_tokens, temperature=temperature)
        try:
            realcheck.require_flag(res.text)            # NotNews (not a real article) propagates: skipped for good
            raw = strip_end_marker(res.text, res.finish_reason)
            title, excerpt, summary, html_body, importance = _parse_response(raw)
            check_article_text(title, excerpt, summary, html_body, min_body_chars)
        except Incomplete as e:
            last = e
            if res.finish_reason == "length":
                max_tokens = min(int(max_tokens * 1.6), 6000)   # truncated: allow more room
            prompt = base_prompt + ("\n\nYour previous attempt was incomplete or malformed "
                                    f"({str(e)[:120]}). Write the COMPLETE article this time and finish with the {END_MARKER} line.")
            temperature = min(temperature, 0.3)
            continue
        images = article.get("images") or []
        return {
            "title": title,
            "excerpt": excerpt,
            "summary": summary,
            "html_body": _interleave_images(html_body, images),
            "img": images[0] if images else None,
            "source_url": article.get("url"),
            "source_name": article.get("source"),
            "voice": voice["name"],
            "importance": importance,
            "sections": _parse_sections(raw),
        }
    raise last
