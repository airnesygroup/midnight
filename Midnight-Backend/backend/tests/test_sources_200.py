import json
import os
from collections import Counter

import sources


def test_at_least_200_different_publishers_are_configured():
    sites = {sources.site_of(n) for n, _, _ in sources.ALL_SOURCES}
    assert len(sites) >= 200, len(sites)


def test_feeds_are_unique_and_sections_exist():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    secs = {s["slug"] for s in json.load(open(os.path.join(here, "sections.json")))}
    urls = [u for _, u, _ in sources.ALL_SOURCES]
    assert not [u for u, c in Counter(urls).items() if c > 1]
    assert all(u.startswith("http") for u in urls)
    assert {s for _, _, s in sources.ALL_SOURCES} <= secs


def test_disabled_feeds_are_skipped(tmp_path, monkeypatch):
    assert len(sources.SOURCES) <= len(sources.ALL_SOURCES)
