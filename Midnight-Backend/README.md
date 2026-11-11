# Midnight pipeline: live news → MongoDB, with a monitoring dashboard

A Python backend reads 86 feeds from **59 news sites** across every Midnight
section, writes an original article from each with Groq, and **pushes it straight
to MongoDB** in the Lovable project's `articles` schema. Once a day it also
writes **The Midnight Report** (newsletter) to the `reports` collection.
The React front end is a **dashboard** (same look as the Lovable admin) showing
what the system is doing right now and everything it has finished.
Nothing is stored locally.

## Quick start

Requirements: Python 3.9+, Node 18+.

1. Edit `backend/.env`: put your Groq keys in `GROQ_API_KEYS` (comma-separated, as many as you have).
   `MONGODB_URI` is already set; `MONGODB_DB` is `midnight` (the name hard-coded in the Lovable app).
2. `python3 run.py --live` starts the API, the dashboard and the live pipeline, and opens the dashboard.

Other commands:

```bash
python3 run.py                    # dashboard + API only
python3 run.py --generate 50      # publish 50 articles first, then start
cd backend && .venv/bin/python generate.py --count 50     # pipeline only
cd backend && .venv/bin/python generate.py --forever      # pipeline only, continuous
cd backend && .venv/bin/python generate.py --count 5 --dry-run   # build + check, no writes
```

## What is guaranteed before anything is published

| Rule | How |
|---|---|
| Never the same article or story twice | URL (tracking params stripped) + headline similarity against everything in `ingestLedger`/`articles`, across all outlets; the rewritten headline is checked again |
| One article per source, in turn | Fixed rotation interleaved across sections; at most 3 candidate tries per visit |
| Always a real image | The image is **downloaded and verified** (https, HTTP 200, `image/*`, real image bytes that decode, at least 400x220 px, photo-like shape, not a logo/icon/placeholder). No verified image means the article is skipped *before* any LLM credit is spent. `image.png`-style values are rejected |
| Never half-written | The model's reply must finish normally (`finish_reason=stop`) **and** end with a `===END===` marker. Then: title, excerpt, exactly 3 summary points, enough body, balanced HTML, last paragraph ends like a sentence, no template leftovers or refusals. Truncated replies are retried once, then dropped |
| Source URL always stored | `source_name` / `source_url` are required by the final gate and saved on every article |
| Schema-valid | Strict check against the Lovable `articleSchema` right before the insert; HTML sanitised with an allowlist |

## Groq keys

**Cooldown is 15 minutes** (`KEY_PAUSE_HOURS=0.25`): when every work key is out, the loop waits 15 minutes and tries again.

**One key is reserved for the Midnight Report** (with 2+ keys). News and trends never use it, so the report can always
be written even when everything else is used up. It is the usable key with the most credit left (Groq exposes no balance,
so that is the fewest tokens used in the last 24 hours). It is checked every 15 minutes and re-picked only after it has been
held 10 hours, and only if another key has clearly (20%) more room. A new reserved key takes over in one step while it is
verified usable, so there is never a gap and a good key is never dropped for a worse one. If the reserved key is
rate-limited the report may use any other usable key. The Keys page shows which key is reserved.


`GROQ_API_KEYS=key1,key2,...` (also `GROQ_API_KEY`, `GROQ_API_KEY_1`, ...). The current key is used until it
fails, then the next. A rate-limited key rests until its Retry-After (1 minute if none is given; 15 minutes for
out-of-credit errors); a rejected key (401/403) is disabled until restart. When **every** key is out, the
pipeline **pauses for 15 minutes** (`KEY_PAUSE_HOURS`, default 0.25), clears the cool-downs, retries from key 1, and
pauses again if they are still out. It never keeps scraping while it cannot write.

**Rate limit vs out of credit.** Groq's limits are per organization, so keys from one Groq account share them. A
per-minute limit (tokens per minute) clears in seconds: the pipeline now waits it out (up to 2 minutes) instead of
marking keys dead and pausing the pipeline. Only messages that really say the account is out of credit
(`insufficient`, `credit balance`, ...) or a long Retry-After (daily limit) put a key to sleep. The cause of the
old behaviour: Groq's ordinary rate-limit message contains an upgrade link ending in `/settings/billing`, and the word
"billing" used to count as "out of credit". `GROQ_REASONING_EFFORT` (default `low`, `off` disables) keeps gpt-oss from
spending the token budget on hidden reasoning, which was truncating many replies (`finish_reason='length'`).

**Fact-check budgets.** The second model call gets 1,500 tokens (the report's 3,000), because the model spends part of
the budget on hidden reasoning and a cut-off answer used to mean "could not verify, reject". A cut-off answer is asked
again once with double the room; if it still cannot finish, `strict` rejects, `balanced`/`light` keep the article on the local
checks and print a "? fact-check call could not complete" line.

**Strictness (`FACTCHECK_MODE` in `.env`).** `balanced` (default): invented numbers block an article; a quotation that
is not word for word is not fatal, its quotation marks are removed and it reads as a paraphrase; names only block when
more than 5 are unseen; the second LLM check still runs. `strict`: the original behaviour (bad quotes and names block).
`light`: only invented numbers block, no LLM call. `FACTCHECK_LLM=off` additionally removes the LLM call in any mode.
`python clean_writer.py` empties the writer's memory in MongoDB (dry run; `--go` deletes, `--all` adds articles/trends/reports).
`python reopen_skipped.py` (dry run) / `--go` makes the writer look again at stories that were skipped for a fixed check
(fact-check, no verifiable image); skipped URLs are otherwise remembered forever.

**Quotes and images.** A quotation must match the source word for word, but punctuation and dash style are
ignored (a full stop where the source has a comma is not a fabrication); an ellipsis splits a quote into pieces that
must each match. Image hosts that answer 406 to the browser-style Accept header are retried with `*/*`, and photos
labelled `binary/octet-stream` are judged by their bytes (signature + decode), not the label.

## Pause / Go live (dashboard buttons)

The **Live activity** and **Midnight Trends** pages each have buttons for their own loop. They call
`POST /api/control/{news|trends}/pause` and `/resume`; the loops are separate processes, so the wish is
stored in MongoDB (`systemControl`) and each loop checks it between steps (`GET /api/control` shows it).

* **Pause**: finishes the article/post it is writing (the credit is already spent), then starts nothing new and
  waits, **even when every key still has credit**. It stays paused until you press Go live. The badge shows
  "Pausing" until the current item is done, then "Paused by you".
* **Go live**: carries on, and always tries the keys again right away (cool-downs are cleared).
* **Retry now** (shown instead of Go live while the loop is cooling down because every key is out of credit):
  ends the wait immediately and tries the keys. If they are still out of credit it logs
  "Retry failed ... cooling down again" and starts a fresh cool-down, so it can never spin.
* Pause during a cool-down turns it into a manual pause. Go live on a loop that is **not running at all** starts
  it (`generate.py --forever` / `generate_trends.py --forever`) from the API process. Set `LOOP_AUTOSTART=0` in
  `.env` to turn that off.

## What the website hero shows

The site's `topNews()` reads two fields on each article: `featured` and `headlineWeight`. This backend now fills
them with real values (`headlines.py`):

* While each article is rewritten, Groq also returns `IMPORTANCE: 0-100`. A reply without a valid score is
  treated as incomplete, like every other completeness check.
* `headlineWeight` = that score + a section adjustment (world, politics, business, tech, US and the regions
  +10; climate, health, science, crypto 0; sport, entertainment, gaming, lifestyle, culture, opinion −18)
  + 6 for every *other* outlet that covered the same story (max +18), clamped to 0-100.
* After every publish, the top `FEATURED_COUNT` (default 8) stories of the last `FEATURED_WINDOW_HOURS`
  (default 30) with weight ≥ `FEATURED_MIN_WEIGHT` (default 45) get `featured: true`; the flag is cleared from
  the rest. With fewer than 3 candidates nothing is featured (the site would ignore it anyway).
* The raw score and the list of outlets live in our own `headlineSignals` collection, so the strict article
  schema is untouched.

Edit `SECTION_ADJUST` in `headlines.py` to change which sections dominate.

## How hard stories are retried

A failed fact-check is a small correction, so it is treated as one: the writer gets the unsupported statements and rewrites,
up to `FACTCHECK_ROUNDS` times (default 8, 5-10) for articles and Midnight Trends alike. Images are searched just as hard:
up to `IMAGE_TRIES` (default 10, 5-10) different candidates (the feed's, then the article page's og:image / twitter:image /
JSON-LD / srcset), a timeout or 5xx is looked at again with the page as Referer, and a story that failed only because of
network trouble is recorded as *failed* (retried on a later pass) instead of being skipped for good. `WRITE_TRIES` (default 5)
covers cut-off drafts. The Midnight Report ignores all of these limits: it never stops until a report exists.

## The Midnight Report (newsletter)

A newsletter for people who do not want to read the news: the important stories since the last edition, each as a
dense brief with every key detail (who, what, numbers, reactions, what happens next), written in a conversational,
witty, plain-English newsletter voice (see `VOICE` in `report.py`).

* **Window = since the last report.** It covers every article written from the end of the previous report's window
  (stored in the `reportRuns` collection) up to the moment it is written. No previous report: the last 24 hours.
  Consecutive windows touch exactly, so nothing is missed and nothing is told twice; if the pipeline was off for
  days, the next report catches up on all of it.
* **Fixed schedule: 13:00 UTC, written 30 minutes early.** Each edition belongs to a UTC date and is due at
  `REPORT_EDITION_TIME_UTC` (13:00) minus `REPORT_LEAD_MINUTES` (30), so writing starts at 12:30 UTC and the report is out
  before 13:00. The time a report was actually written never moves the next one: a report written late at 14:10 still
  leaves tomorrow's due at 12:30 UTC.
* **Own loop with safety nets, so a report is never missed.** The report runs on its own thread (`ReportLoop`),
  independent of the article loop, key cool-downs and the Pause button. It wakes at start and then every hour (sooner when
  the 12:30 deadline is nearer, so it starts on the dot). Catch-up checks: if a deadline passed and nothing was written
  since (pipeline down), it writes at once for that missed date; a 24-hour check (`REPORT_EVERY_HOURS`) writes today's
  report if a whole day (+1 h) passed with nothing written; an error is retried after 1 minute. Only fewer than 5 stories
  in the window can hold a due report (it then looks again every 5 minutes).
* **Picks the important ones.** Ranks the window's articles with the headline weights above, keeps weight >= 50, at
  most `REPORT_MAX_STORIES` = 12, at most 4 per section; topped up to 5 on a quiet day.
* **Shape.** Lead story (130-450 words), one section per remaining story (40-220 words each), an introduction and a
  "what to watch" last word. The writer sees each article's text and may use only facts from it.
* **Fact-checked before it is stored** (`factcheck.verify_report`): every number and quotation must be in the stories it
  was given, names are checked, and a second model call lists unsupported claims. A rejected, cut-off or malformed draft is
  **corrected and rewritten immediately, with no back-off and no limit** until one passes. Each round sees only the last two
  drafts' problems; after 3 failed rounds the temperature drops, and every 4 rounds from the 5th the least important story is
  dropped (never below 5) so the newsletter is easier to get right. Each rejected draft shows as a "Retrying" event.
  The only waiting is for a usable API key (up to 60 s at a time).
* **Report events** go to Live activity, to a "Report activity" panel on the Midnight Reports page
  (`/api/reports/events`, `/api/reports/runs`) and to the terminal.
* Same completeness rules: `===END===` marker, normal finish, no cut-off paragraphs. Shape in MongoDB is unchanged
  (`reports` collection, one per UTC date); the window and story ids are kept in `reportRuns`.

## Encryption

The Lovable app's `COMMUNITY_ENCRYPTION_KEY` (AES-256-GCM) protects **reader data only** (profile names,
bios, comments). Articles and reports are stored and read as plain documents, so this backend does **not**
encrypt them and needs no key.

## Dashboard

Live activity (every visit, skip, write, publish, key switch, pause, report), finished articles (with source
link), Midnight Reports, per-source stats and API key health. It reads the backend's `/api/status`,
`/api/events`, `/api/posts`, `/api/reports` and `/api/sources`. The pipeline can run in a separate process;
the two talk through MongoDB.

## Tests

```bash
pip install pytest mongomock
cd backend && python3 -m pytest tests -q
```
(offline: mock MongoDB, canned feeds, fake Groq client)
## Midnight Trends (Google Trends -> `trends` collection)

A second, independent loop (`backend/generate_trends.py`) runs **in parallel** with the news loop and shares nothing
with it except the database. `python3 run.py --live` starts both; `--no-trends` starts news only. It can also run alone:

```bash
cd backend && .venv/bin/python generate_trends.py --forever      # keep going
cd backend && .venv/bin/python generate_trends.py                # write everything waiting, then stop
cd backend && .venv/bin/python generate_trends.py --count 5 --dry-run
```

Each cycle (every `TREND_INTERVAL_SECONDS`, default 900):

1. **Read Google Trends "Trending now"** (public RSS, no key) for every country in `TREND_GEOS` and merge the same trend
   across countries. Every trend is written to the permanent **`trendLedger`** the moment it is seen, before anything is written.
2. **Biggest first.** Takes the largest trend still waiting: new ones plus earlier ones that could not be finished.
3. **Finds and reads the top articles** about it (Google's own linked stories, then Bing News RSS, then Google News RSS).
   Not limited to verified news sites: whatever can be read about the trend is material.
4. **Writes its own blog post** with Groq (same completeness rules as articles: finished reply, `===END===`, 3 summary points,
   balanced HTML, last sentence finished), with a verified real image, hashtags and a `headlineWeight` from Google's traffic
   floor, number of countries and number of sources.
5. **Pushes to the `trends` collection** (strict `trendSchema`: no `html_body`, section, tag, desk or voice). Never to `articles`.

Never twice: same trend (word order ignored), the same event under a different search (sources overlap), or a headline that
matches an existing post are all skipped. A trend with thin sources or no usable image is retried after 1h, 3h and 8h and
then given up (`skipped`). Adult/explicit searches are never written (`TREND_BLOCKLIST` adds more), and the writer may answer
`SKIP:` when it cannot write about something honestly.

`trendLedger` statuses: `seen` (recorded, not written yet), `pending` (retry later), `published`, `skipped`.
If the loop is offline or out of Groq credit, whatever it had seen stays in the ledger and is written on the next run.
(Google's feed only lists what is trending now, so a trend that appeared and vanished while the loop was offline
and was never seen cannot be recovered.)

Dashboard: **Midnight Trends** tab (activity, published trends, every trend ever seen). API: `/api/trends`,
`/api/trends/hashtags`, `/api/trends/status`, `/api/trends/events`, `/api/trends/ledger`, `/api/trends/{slug-or-id}`.
New collections: `trends`, `trendLedger`, `trendEvents`; the loop's state is `systemState` `_id: "trends"`.
Settings: `TREND_GEOS`, `TREND_INTERVAL_SECONDS`, `TREND_MAX_ATTEMPTS`, `TREND_BLOCKLIST` (see `backend/.env.example`).

## Hallucination guard and section choice

**Sections are read live from the MongoDB `sections` collection** (the same list the site uses), refreshed at the start of every pass. `sections.json` is only a first-run seed and is never used to re-add sections you removed.

* **Sections come from the story, not the feed.** The writer model picks 1-3 sections from the exact list in
  `backend/sections.json` (the same list the site uses). The first is the primary (`section`, `tag`, `desk`);
  all of them are stored in `sections`. If the model returns nothing usable, the feed's own section is the fallback.
  `world` is never the primary when a more specific section was chosen.
* **Every article is fact-checked against its source before it is pushed** (`backend/factcheck.py`):
  1. a free local check: every number, quotation and name in the article must appear in the source text;
  2. a second model call that lists any statement the source does not support (invented relationships, backstory,
     motives). Set `FACTCHECK_LLM=off` in `.env` to skip this call and save credit (the local check still runs).
  A failing article is rewritten once with the unsupported claims listed; if it still fails it is **skipped, not
  published** (the ledger records why). If the fact-check reply is cut off or malformed the article is not published.
* The writer now runs at temperature 0.4 (was 0.9) and is told not to add anything the source does not say.
* **The same guard covers Midnight Trends posts** (`factcheck.verify_trend`: checked against the page texts plus the
  countries / search-volume line the writer was shown; one corrective rewrite, then deferred, never published) **and the
  Midnight Report** (see above). Trend writer temperature is 0.4 (was 0.8).

**Deploy order:** update the Lovable app and the Mongo validator (`mongodb/schema.json`) first, then this backend.
The new `sections` field is rejected by the old strict schema.

## Bulk-scrape switches (backend/.env)

* `SCRAPE_MAX_AGE_DAYS` - how far back feed items are read. Default `183` (six months) for the bulk scrape; set it to `1` afterwards so only the last day is picked up.
* `PUBLISHED_AT_MODE` - `source` (default, exactly as before) keeps each story's own original publish time in `publishedAt`; `own` stamps stories with our own publishing time instead. Switch to `own` after the bulk scrape.

## Generic pictures and stub articles

* **Generic-image guard** (`images.py`). Every accepted hero image gets a perceptual fingerprint (dHash). A picture is
  refused when it is known placeholder art (`KNOWN_GENERIC`, currently NPR's headphones artwork), when the same outlet
  already used that exact picture on another article (`IMAGE_MAX_REUSE_SAME_SOURCE`, default 1), or when it is already on
  `IMAGE_MAX_REUSE_ANY` (default 3) published articles. Refused pictures fall through to the next candidate on the page;
  no real picture = the story is skipped before any LLM credit is spent. Used pictures are remembered in the
  `imageFingerprints` collection. Add more placeholder art to `KNOWN_GENERIC` (use `images.dhash`).
* **Boilerplate stripped** (`boilerplate.py`). Publisher disclaimers (NPR's "does not offer or accept money..."),
  transcript notices, newsletter/social prompts and copyright lines are removed from the source text before it is counted
  or written about. `MIN_SOURCE_WORDS` (default 90) real words are then required, so audio-only teasers are skipped.
* **Fix what is already published:** `python fix_generic_images.py` (dry run), then
  `python fix_generic_images.py --go --unpublish --trends`. It swaps placeholder pictures for the real one from the
  article page and drafts items that have none.

## Collecting Groq keys from your own accounts (`backend/get_groq_keys.py`)

`pip install selenium`, copy `emails.txt.example` to `emails.txt` (your addresses, one per line), then
`python get_groq_keys.py`. It opens clean Chrome windows (5 at a time, `--batch`), goes to the Groq sign-up page, types each
address and clicks Continue. You then open each verification email and paste its link into the terminal (or type the code
into that window and press Enter): about 10 seconds per account. The script does not read inboxes or get around Groq's
email check. After that it creates the key, captures it and saves it to `groq_keys.csv`; the line to paste into
`backend/.env` is written to `groq_api_keys.txt`. If a button is not found, do that step by hand in the open window and the
key is still picked up. Re-running skips addresses that already have a key. Both files are git-ignored.
