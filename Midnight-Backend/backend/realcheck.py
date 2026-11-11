"""
The writer model must CONFIRM that the material is a real news article before anything is published. This is a second
layer on top of the hard-coded checks (thin-source gate, boilerplate stripping, completeness, fact-check), not a
replacement: the model is better than any rule at telling a real report from a scraped blob of text.

The reply must contain the line   REAL_NEWS_ARTICLE: yes   or   REAL_NEWS_ARTICLE: no - <short reason>.
  no       -> NotNews is raised; the story is skipped for good (it is not a news article, writing it again will not help)
  missing  -> Incomplete is raised; the writer is asked again (the existing retry loop)
Used by BOTH the article writer (rewriter.py) and the trends writer (trend_writer.py).
"""

import re

from quality import Incomplete

FLAG = "REAL_NEWS_ARTICLE"

INSTRUCTION = f"""FIRST decide whether the material above is a REAL news or information article: a report about a specific
event, announcement, finding, person, place or topic, with actual content. It is NOT a real article if it is a text
blob such as site navigation or menus, a cookie / consent / subscription / paywall / login notice, an error or
"not found" page, a list of links or headlines, an index or tag page, a product or price listing, advertising or
promotional copy, a video or audio player caption, a legal disclaimer, or a bare headline with nothing behind it.
Answer on the {FLAG} line. If the answer is no, put that line ONLY (with a short reason) and stop: no article."""

FORMAT_LINE = f"{FLAG}: <yes, or: no - <short reason>>"


class NotNews(Exception):
    """The model says the material is not a real news article."""


_RX = re.compile(rf"^\s*{FLAG}\s*:\s*(yes|no)\b[\s:.\-–—]*(.*)$", re.I | re.M)


def require_flag(text):
    """Raises NotNews / Incomplete. Returns None when the model confirmed the material is a real article."""
    m = _RX.search(text or "")
    if not m:
        raise Incomplete(f"reply is missing the {FLAG} line")
    if m.group(1).lower() == "no":
        raise NotNews((m.group(2) or "the writer judged the material not to be a real news article").strip()[:200])
