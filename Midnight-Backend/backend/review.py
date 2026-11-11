"""Shared wording for the admin Skipped / Failed pages (articles and trends): the final outcome in plain words."""


def describe(outcome, attempts, cap, next_try=None, title=None, reason=None):
    n = int(attempts or 0)
    if outcome == "published":
        t = f" as “{title[:80]}”" if title else ""
        return (f"Passed later: published{t} after {n} earlier miss{'es' if n != 1 else ''}." if n
                else f"Published{t}.")
    if outcome == "retrying":
        when = f" at {next_try}" if next_try else " soon"
        return f"Will be retried{when} (try {min(n + 1, cap)} of {cap}). Not abandoned."
    if outcome == "queued":
        return "Waiting for its turn to be written."
    return "Abandoned: this story will never be retried." + (f" Last reason: {reason[:120]}" if reason else "")


def reasons_from(history, fallback_reason, fallback_status, fallback_at, kinds=None):
    """Every reason the story was ever skipped/failed, oldest first. Rows written before history existed
    fall back to the single stored reason."""
    out = []
    for h in history or []:
        k = h.get("kind") or h.get("status")
        if k in ("published", "seen", "queued"):
            continue
        if kinds and k not in kinds:
            continue
        out.append({"at": h.get("at"), "kind": k, "reason": h.get("reason"), "attempt": h.get("attempt")})
    if not out and fallback_reason and fallback_status in ("skipped", "failed", "pending"):
        out.append({"at": fallback_at, "kind": fallback_status, "reason": fallback_reason, "attempt": None})
    return out
