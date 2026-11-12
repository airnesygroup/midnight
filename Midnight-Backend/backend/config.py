"""
Central configuration. Import this FIRST from any entry point.

Every secret and setting comes from backend/.env (or the real environment).
Nothing is hard-coded in the code.

  GROQ_API_KEYS      comma-separated list of Groq keys. GROQ_API_KEY and
                     GROQ_API_KEY_1, _2, ... are accepted too, and each of
                     them may also hold several keys separated by commas.
  MONGODB_URI        MongoDB connection string
  MONGODB_DB         database name (the Lovable app uses "midnight")
  GROQ_MODEL         optional, default openai/gpt-oss-120b
  KEY_PAUSE_HOURS    pause length when every key is out of credit (default 0.25 = 15 minutes)
  REPORT_EDITION_TIME_UTC   Midnight Report edition time, HH:MM UTC (default 13:00)
  REPORT_LEAD_MINUTES       write it this many minutes early (default 30) -> due at 12:30 UTC, fixed, never drifts
  REPORT_EVERY_HOURS        24-hour safety check: nothing written for this +1 h -> write at once (default 24)
  REPORT_MIN_ARTICLES       stories needed from the edition day before a report is written (default 20)
  REPORT_MAX_STORIES        most stories the newsletter covers (default 12)
  SCRAPE_MAX_AGE_DAYS       how far back the scraper reads feed items, in days (default 183 = six months for the bulk
                            scrape; set to 1 afterwards so only the last day is picked up)
  PUBLISHED_AT_MODE         source = keep each story's own original publish time (default, exactly as before)
                            own    = stamp stories with OUR publishing time (set this after the bulk scrape)
  IMAGE_MAX_REUSE_SAME_SOURCE  refuse a picture an outlet already used on this many other articles (default 1)
  IMAGE_MAX_REUSE_ANY          refuse a picture already on this many articles overall (default 3)
  MIN_SOURCE_WORDS          real words a source page needs before it is written about (default 90)
  FEATURED_COUNT            how many recent stories get featured:true for the hero (default 8)
  FEATURED_WINDOW_HOURS     how far back stories can be featured (default 30)
"""

import os
import re
import sys

from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BACKEND_DIR, ".env")

load_dotenv(ENV_FILE)

PLACEHOLDERS = {"", "your_key_here", "gsk_your_actual_key", "your_groq_api_key",
                "your_mongodb_uri_here"}


def env(name, default=None):
    v = (os.environ.get(name) or "").strip()
    return v if v else default


def get_groq_keys():
    """All distinct, non-placeholder Groq keys, in a stable order."""
    raw = []
    for name in sorted(os.environ):
        if re.fullmatch(r"GROQ_API_KEYS?(_\d+)?", name):
            # every variant may hold one key or several (comma/space/semicolon separated)
            raw += re.split(r"[,;\s]+", os.environ[name])
    keys, seen = [], set()
    for k in (r.strip().strip('"').strip("'") for r in raw):
        if k and k not in PLACEHOLDERS and k not in seen:
            seen.add(k)
            keys.append(k)
    return keys


def get_groq_model():
    return env("GROQ_MODEL", "openai/gpt-oss-120b")


MAX_WAIT_SECONDS = 900   # no cooldown, pause or retry wait anywhere is ever longer than 15 minutes


def max_wait_seconds():
    """Upper limit for every cooldown / pause / retry wait (MAX_WAIT_MINUTES, default 15, never above 15)."""
    try:
        v = int(float(env("MAX_WAIT_MINUTES", "15")) * 60)
    except ValueError:
        v = MAX_WAIT_SECONDS
    return max(30, min(v, MAX_WAIT_SECONDS))


def key_pause_seconds():
    """Wait when every key is out of credit. KEY_PAUSE_HOURS (default 0.25 = 15 min), capped at 15 minutes."""
    try:
        v = int(float(env("KEY_PAUSE_HOURS", "0.25")) * 3600)
    except ValueError:
        v = MAX_WAIT_SECONDS
    return max(30, min(v, max_wait_seconds()))


def item_retry_settings():
    """How often a skipped/failed story is looked at again before it is abandoned for good.
      ITEM_MAX_ATTEMPTS  total tries per article that failed for a retryable reason (default 6 = the first try + 5
                     retries, 2..10). Every retry uses a DIFFERENT approach (pagefetch.ladder).
    Waits between tries are 15 min, 30 min, 1 h, 2 h, 4 h (storage.RETRY_MINUTES)."""
    try:
        n = int(float(env("ITEM_MAX_ATTEMPTS", "6")))
    except ValueError:
        n = 6
    return {"max_attempts": max(2, min(10, n))}


def watchdog_settings():
    """WATCHDOG_STALE_MINUTES: a loop whose progress has not moved for this long is considered hung and is restarted
    (default 20, minimum 16 because a cooldown may last 15). WATCHDOG_CHECK_SECONDS: how often the watchdog looks."""
    def num(name, default, lo, hi):
        try:
            v = int(float(env(name, str(default))))
        except ValueError:
            v = default
        return max(lo, min(hi, v))
    return {"stale_seconds": num("WATCHDOG_STALE_MINUTES", 20, 16, 240) * 60,
            "check_seconds": num("WATCHDOG_CHECK_SECONDS", 30, 10, 300)}


def get_mongo_uri():
    uri = env("MONGODB_URI")
    if not uri or uri in PLACEHOLDERS:
        raise RuntimeError(
            f"MONGODB_URI is missing in {ENV_FILE}.\n"
            "  Open backend/.env and set:  MONGODB_URI=mongodb+srv://user:pass@cluster/")
    return uri


def get_mongo_db_name():
    return env("MONGODB_DB", "midnight")


def report_settings():
    def num(name, default):
        try:
            return int(env(name, default))
        except ValueError:
            return int(default)
    hh, mm = (env("REPORT_EDITION_TIME_UTC", "13:00") + ":0").split(":")[:2]
    return {"hour": int(hh) % 24, "minute": int(mm) % 60,
            "lead_minutes": num("REPORT_LEAD_MINUTES", "30"),
            "min_articles": num("REPORT_MIN_ARTICLES", "20"),
            "max_stories": num("REPORT_MAX_STORIES", "12"),
            "every_hours": num("REPORT_EVERY_HOURS", "24")}


def scrape_settings():
    """SCRAPE_MAX_AGE_DAYS (default 183 = six months) and PUBLISHED_AT_MODE ('source' default | 'own')."""
    try:
        days = float(env("SCRAPE_MAX_AGE_DAYS", "183"))
        if days <= 0:
            days = 183.0
    except ValueError:
        days = 183.0
    mode = env("PUBLISHED_AT_MODE", "source").lower()
    return {"max_age_days": days, "published_at_mode": mode if mode in ("source", "own") else "source"}


def check_key_or_exit():
    """Fail once, upfront, instead of N times in a loop."""
    if not get_groq_keys():
        print(f"\n\033[31mConfiguration error\033[0m\n\n"
              f"No Groq API key found. Open {ENV_FILE} and set:\n"
              "  GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3\n"
              "(free keys: https://console.groq.com/keys)\n", file=sys.stderr)
        sys.exit(1)
    return True


def headline_settings():
    def num(name, default):
        try:
            return int(env(name, default))
        except ValueError:
            return int(default)
    return {"featured_count": num("FEATURED_COUNT", "8"),
            "window_hours": num("FEATURED_WINDOW_HOURS", "30"),
            "min_weight": num("FEATURED_MIN_WEIGHT", "45")}


def trend_settings():
    """Settings for the Midnight Trends loop (generate_trends.py)."""
    def num(name, default):
        try:
            return int(float(env(name, default)))
        except ValueError:
            return int(default)
    geos = [g.strip().upper() for g in re.split(r"[,\s;]+", env("TREND_GEOS", DEFAULT_TREND_GEOS)) if g.strip()]
    extra = [w.strip().lower() for w in re.split(r"[,;]+", env("TREND_BLOCKLIST", "")) if w.strip()]
    return {"geos": geos, "interval": num("TREND_INTERVAL_SECONDS", "900"),
            "max_attempts": num("TREND_MAX_ATTEMPTS", "3"), "blocklist": DEFAULT_TREND_BLOCKLIST + extra}


DEFAULT_TREND_GEOS = ("US,GB,CA,AU,IN,NG,KE,ZA,GH,EG,DE,FR,ES,IT,NL,BR,MX,AR,JP,KR,ID,PH,PK,SG,TR,SA,AE,PL,SE,TH,VN,MY,NZ,IE")
# Adult/explicit searches are never written about. Extend with TREND_BLOCKLIST=word1,word2
DEFAULT_TREND_BLOCKLIST = ["porn", "xxx", "nude", "nudes", "onlyfans", "sex tape", "hentai", "nsfw", "erotic"]


def factcheck_settings():
    """FACTCHECK_LLM=off skips the second-model fact check (the free local grounding check always runs).
    FACTCHECK_MODE: strict | balanced (default) | light, see factcheck.py."""
    mode = (env("FACTCHECK_MODE", "balanced") or "balanced").lower()
    if mode not in ("strict", "balanced", "light"):
        mode = "balanced"
    llm_on = (env("FACTCHECK_LLM", "on") or "on").lower() not in ("off", "0", "false", "no")
    return {"llm": llm_on and mode != "light", "mode": mode}


def image_guard_settings():
    """How often the same picture may appear before it counts as a generic placeholder.
      IMAGE_MAX_REUSE_SAME_SOURCE  articles of the SAME outlet that may already use this exact picture (default 1:
                                   a second story from that outlet with the same picture is refused; 0 = off)
      IMAGE_MAX_REUSE_ANY          published articles from any outlets that may already use it (default 3; 0 = off)"""
    def num(name, default):
        try:
            return max(0, int(float(env(name, str(default)))))
        except ValueError:
            return default
    return {"same_source": num("IMAGE_MAX_REUSE_SAME_SOURCE", 1), "any_source": num("IMAGE_MAX_REUSE_ANY", 3)}


def source_settings():
    """MIN_SOURCE_WORDS: real article words (after publisher disclaimers are stripped) a source page must have
    before any LLM credit is spent on it (default 90). Audio-only teasers and two-sentence stubs fall below it."""
    try:
        words = max(30, int(float(env("MIN_SOURCE_WORDS", "90"))))
    except ValueError:
        words = 90
    return {"min_words": words}


def retry_settings():
    """How hard the writers try before giving up on an article / trend (the Midnight Report never gives up).
      FACTCHECK_ROUNDS  corrective rewrites after a failed fact-check      (default 8, kept between 5 and 10)
      IMAGE_TRIES       different image candidates tried per story         (default 10, kept between 5 and 10)
      WRITE_TRIES       tries to get a COMPLETE (not cut-off) draft per write (default 5, kept between 3 and 10)"""
    def num(name, default, lo, hi):
        try:
            v = int(float(env(name, str(default))))
        except ValueError:
            v = default
        return max(lo, min(hi, v))
    return {"factcheck_rounds": num("FACTCHECK_ROUNDS", 8, 5, 10),
            "image_tries": num("IMAGE_TRIES", 10, 5, 10),
            "write_tries": num("WRITE_TRIES", 5, 3, 10)}
