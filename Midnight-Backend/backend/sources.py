"""
The news sources. Each entry is (site name, RSS/Atom feed URL, section slug).

The section slug is one of the Midnight sections in sections.json, so every
article lands in the section its feed belongs to. Sites with several feeds
(BBC, Guardian, NYT, NPR...) appear once per section but count as ONE site in
the rotation's "site" count.

Feed URLs move around. A dead feed is never fatal: it is logged, skipped for
that pass, and retried on the next one. Add/remove lines freely.
"""

SOURCES = [
    # ---- Tech --------------------------------------------------------
    ("TechCrunch", "https://techcrunch.com/feed/", "tech"),
    ("The Verge", "https://www.theverge.com/rss/index.xml", "tech"),
    ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "tech"),
    ("Wired", "https://www.wired.com/feed/rss", "tech"),
    ("Engadget", "https://www.engadget.com/rss.xml", "tech"),
    ("BBC Technology", "https://feeds.bbci.co.uk/news/technology/rss.xml", "tech"),
    ("Mashable", "https://mashable.com/feeds/rss/all", "tech"),
    ("ZDNet", "https://www.zdnet.com/news/rss.xml", "tech"),
    ("VentureBeat", "https://venturebeat.com/feed/", "tech"),
    ("TechRadar", "https://www.techradar.com/rss", "tech"),
    ("Gizmodo", "https://gizmodo.com/rss", "tech"),
    ("The Next Web", "https://thenextweb.com/feed", "tech"),
    ("MIT Technology Review", "https://www.technologyreview.com/feed/", "tech"),
    ("CNET", "https://www.cnet.com/rss/news/", "tech"),
    # ---- World -------------------------------------------------------
    ("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml", "world"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "world"),
    ("The Guardian World", "https://www.theguardian.com/world/rss", "world"),
    ("NYT World", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "world"),
    ("NPR World", "https://feeds.npr.org/1004/rss.xml", "world"),
    ("DW", "https://rss.dw.com/rdf/rss-en-all", "world"),
    ("France 24", "https://www.france24.com/en/rss", "world"),
    ("Sky News", "https://feeds.skynews.com/feeds/rss/world.xml", "world"),
    ("CBS News", "https://www.cbsnews.com/latest/rss/world", "world"),
    ("ABC News", "https://abcnews.go.com/abcnews/internationalheadlines", "world"),
    ("Euronews", "https://www.euronews.com/rss", "world"),
    ("The Conversation", "https://theconversation.com/global/articles.atom", "world"),
    # ---- Regions -----------------------------------------------------
    ("NPR National", "https://feeds.npr.org/1003/rss.xml", "us"),
    ("The Guardian US", "https://www.theguardian.com/us-news/rss", "us"),
    ("BBC Europe", "https://feeds.bbci.co.uk/news/world/europe/rss.xml", "europe"),
    ("BBC Asia", "https://feeds.bbci.co.uk/news/world/asia/rss.xml", "asia"),
    ("South China Morning Post", "https://www.scmp.com/rss/91/feed", "asia"),
    ("The Japan Times", "https://www.japantimes.co.jp/feed/", "asia"),
    ("BBC Middle East", "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", "middle-east"),
    ("BBC Latin America", "https://feeds.bbci.co.uk/news/world/latin_america/rss.xml", "latin-america"),
    ("ABC News Australia", "https://www.abc.net.au/news/feed/51120/rss.xml", "oceania"),
    ("RNZ", "https://www.rnz.co.nz/rss/world.xml", "oceania"),
    ("BBC Africa", "https://feeds.bbci.co.uk/news/world/africa/rss.xml", "africa"),
    ("Africanews", "https://www.africanews.com/feed/rss", "africa"),
    # ---- Politics ----------------------------------------------------
    ("Politico", "https://rss.politico.com/politics-news.xml", "politics"),
    ("The Hill", "https://thehill.com/feed/", "politics"),
    ("NPR Politics", "https://feeds.npr.org/1014/rss.xml", "politics"),
    ("BBC Politics", "https://feeds.bbci.co.uk/news/politics/rss.xml", "politics"),
    # ---- Business ----------------------------------------------------
    ("CNBC", "https://www.cnbc.com/id/10001147/device/rss/rss.html", "business"),
    ("MarketWatch", "https://feeds.marketwatch.com/marketwatch/topstories/", "business"),
    ("Fortune", "https://fortune.com/feed/", "business"),
    ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "business"),
    ("NYT Business", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "business"),
    # ---- Climate -----------------------------------------------------
    ("Inside Climate News", "https://insideclimatenews.org/feed/", "climate"),
    ("Carbon Brief", "https://www.carbonbrief.org/feed/", "climate"),
    ("Grist", "https://grist.org/feed/", "climate"),
    ("Mongabay", "https://news.mongabay.com/feed/", "climate"),
    ("The Guardian Environment", "https://www.theguardian.com/environment/rss", "climate"),
    # ---- Sport -------------------------------------------------------
    ("ESPN", "https://www.espn.com/espn/rss/news", "sport"),
    ("Sky Sports", "https://www.skysports.com/rss/12040", "sport"),
    ("CBS Sports", "https://www.cbssports.com/rss/headlines/", "sport"),
    ("BBC Sport", "https://feeds.bbci.co.uk/sport/rss.xml", "sport"),
    # ---- Culture / Entertainment / Style -----------------------------
    ("The Guardian Culture", "https://www.theguardian.com/culture/rss", "culture"),
    ("NYT Arts", "https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml", "culture"),
    ("Variety", "https://variety.com/feed/", "entertainment"),
    ("The Hollywood Reporter", "https://www.hollywoodreporter.com/feed/", "entertainment"),
    ("BBC Entertainment", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", "entertainment"),
    ("The Guardian Fashion", "https://www.theguardian.com/fashion/rss", "style"),
    # ---- Health / Science -------------------------------------------
    ("STAT News", "https://www.statnews.com/feed/", "health"),
    ("Medical News Today", "https://www.medicalnewstoday.com/rss/medicalnewstoday.xml", "health"),
    ("NPR Health", "https://feeds.npr.org/1128/rss.xml", "health"),
    ("BBC Health", "https://feeds.bbci.co.uk/news/health/rss.xml", "health"),
    ("ScienceDaily", "https://www.sciencedaily.com/rss/all.xml", "science"),
    ("NASA", "https://www.nasa.gov/feed/", "science"),
    ("Phys.org", "https://phys.org/rss-feed/", "science"),
    ("Space.com", "https://www.space.com/feeds/all", "science"),
    ("New Scientist", "https://www.newscientist.com/feed/home/", "science"),
    ("Scientific American", "https://rss.sciam.com/ScientificAmerican-Global", "science"),
    # ---- Gaming / Crypto / Auto / Travel / Food / Education ---------
    ("IGN", "https://feeds.ign.com/ign/all", "gaming"),
    ("Polygon", "https://www.polygon.com/rss/index.xml", "gaming"),
    ("Kotaku", "https://kotaku.com/rss", "gaming"),
    ("Eurogamer", "https://www.eurogamer.net/feed", "gaming"),
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/", "crypto"),
    ("Cointelegraph", "https://cointelegraph.com/rss", "crypto"),
    ("Autoblog", "https://www.autoblog.com/rss.xml", "automotive"),
    ("Car and Driver", "https://www.caranddriver.com/rss/all.xml", "automotive"),
    ("The Guardian Travel", "https://www.theguardian.com/travel/rss", "travel"),
    ("The Guardian Food", "https://www.theguardian.com/food/rss", "food"),
    ("The Guardian Education", "https://www.theguardian.com/education/rss", "education"),
    ("NYT Real Estate", "https://rss.nytimes.com/services/xml/rss/nyt/RealEstate.xml", "real-estate"),
    # ---- Opinion -----------------------------------------------------
    ("The Guardian Opinion", "https://www.theguardian.com/commentisfree/rss", "opinion"),
    ("NYT Opinion", "https://rss.nytimes.com/services/xml/rss/nyt/Opinion.xml", "opinion"),
]


# ---- the full list: the original feeds plus sources_extra.EXTRA (400 more feeds, ~390 more sites) -------------
from sources_extra import EXTRA  # noqa: E402

_have = {u for _, u, _ in SOURCES}
ALL_SOURCES = SOURCES + [s for s in EXTRA if s[1] not in _have]


def _disabled():
    """Feeds listed in sources_disabled.txt (one URL per line, # comments allowed) are skipped. Written by
    `python check_feeds.py --disable-dead`; edit by hand freely."""
    import os
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources_disabled.txt")
    try:
        with open(path, encoding="utf-8") as f:
            return {ln.split("#")[0].strip() for ln in f if ln.split("#")[0].strip()}
    except OSError:
        return set()


_off = _disabled()
SOURCES = [s for s in ALL_SOURCES if s[1] not in _off]     # what the pipeline actually reads


def site_of(name: str) -> str:
    """'The Guardian World' -> 'The Guardian'. Used only for counting sites."""
    for prefix in ("The Guardian", "BBC", "NYT", "NPR", "ABC News"):
        if name.startswith(prefix):
            return prefix
    return name


def interleaved():
    """
    Source order for the rotation: cycles through sections so two
    consecutive articles are never from the same section if avoidable
    (and never from the same site back to back within a pass).
    """
    by_section = {}
    for s in SOURCES:
        by_section.setdefault(s[2], []).append(s)
    queues = [list(v) for v in by_section.values()]
    out, last_site = [], None
    while any(queues):
        for q in queues:
            if not q:
                continue
            pick = next((i for i, s in enumerate(q) if site_of(s[0]) != last_site), 0)
            s = q.pop(pick)
            out.append(s)
            last_site = site_of(s[0])
    return out
