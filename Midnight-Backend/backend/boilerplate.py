"""
Page furniture that must never be treated as article text: publisher disclaimers, transcript notices, newsletter
and social prompts, copyright lines. NPR, for instance, ends audio stories with "NPR does not offer or accept money
for coverage or interviews..." which, on a two-sentence audio teaser, was enough to pass the length check and ended
up INSIDE a published summary. strip_boilerplate() removes these before the length check and before the writer or
the fact-checker ever see the text.
"""
import re

_PATTERNS = [
    # NPR
    r"NPR does not offer or accept money for coverage or interviews\.?(?:\s*Anyone who makes such an offer or request "
    r"is not an NPR employee and does not represent NPR\.?)?",
    r"Transcripts? (?:are|is) created on a rush deadline by an NPR contractor\.?(?:\s*This text may not be in its final "
    r"form and may be updated or revised in the future\.?)?(?:\s*Accuracy and availability may vary\.?)?"
    r"(?:\s*The authoritative record of NPR[’']s programming is the audio record\.?)?",
    r"This (?:text|transcript|copy) may not be in its final form[^.]*\.",
    # generic prompts / notices
    r"Copyright\s*(?:©|\(c\))?\s*\d{4}\s+[^.\n]{0,80}?\.?\s*All rights reserved\.?",
    r"©\s*\d{4}\s+[^.\n]{0,80}?\.?\s*All rights reserved\.?",
    r"All rights reserved\.",
    r"(?:Sign up|Subscribe)(?: now)? (?:for|to) (?:our|the|this|my)\b[^.\n]{0,100}(?:newsletter|podcast|updates|alerts)[^.\n]*\.?",
    r"Follow (?:us|me|\w+) on (?:Twitter|X|Facebook|Instagram|TikTok|YouTube)[^.\n]*\.?",
    r"Listen to (?:the|this) (?:full )?(?:story|episode|segment|interview|conversation)[^.\n]*\.?",
    r"(?:Story continues below advertisement|Advertisement|Sponsor message|SUPPORT FOR THIS STORY[^.\n]*)",
    r"Support (?:our|independent|nonprofit) (?:journalism|reporting)[^.\n]*\.?",
    r"Click here to [^.\n]{0,100}\.?",
]
_RX = [re.compile(p, re.I) for p in _PATTERNS]


def strip_boilerplate(text):
    """Text without publisher disclaimers / prompts. Paragraph breaks are kept."""
    if not text:
        return ""
    out = text
    for rx in _RX:
        out = rx.sub(" ", out)
    out = re.sub(r"[ \t ]{2,}", " ", out)
    out = re.sub(r" ?\n ?", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def word_count(text):
    return len(re.findall(r"\S+", text or ""))
