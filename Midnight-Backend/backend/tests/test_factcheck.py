"""Hallucination guard + writer-chosen sections. Offline: canned model replies only."""
import os
import sys
from datetime import datetime, timezone

import mongomock
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import factcheck
import generate
import llm
import rewriter
import schema
from dedupe import SeenIndex
from quality import Incomplete
from storage import MongoStorage

SOURCE_TEXT = (
    "Chelsea beat Liverpool 6-5 on penalties after the League Cup fourth-round tie finished 1-1 at Anfield. "
    "Xabi Alonso, the Chelsea manager, said his players showed great composure. "
    "Andoni Iraola is in charge of Liverpool. The shootout went to sudden death before the visitors went through. "
) * 3
ENTRY = {"title": "Chelsea win League Cup shootout at Anfield", "url": "https://x.example.com/1", "text": SOURCE_TEXT,
         "images": ["https://img.example.com/a.jpg"], "source": "Al Jazeera",
         "published_at": datetime.now(timezone.utc)}


def post(body, excerpt="Chelsea won the shootout 6-5 at Anfield after a 1-1 draw.", sections=("sport",)):
    return {"title": "Chelsea win League Cup shootout at Anfield", "excerpt": excerpt,
            "summary": ["Chelsea won 6-5 on penalties at Anfield.", "The tie had finished 1-1 after normal time.",
                        "Xabi Alonso praised the composure of his players."],
            "html_body": body, "img": ENTRY["images"][0], "source_url": ENTRY["url"], "source_name": "Al Jazeera",
            "voice": "Explainer", "importance": 40, "sections": list(sections)}


GOOD = ("<p>Chelsea beat Liverpool 6-5 on penalties after a 1-1 draw at Anfield in the League Cup.</p>"
        "<p>Xabi Alonso, the Chelsea manager, said his players showed great composure.</p>"
        "<p>Andoni Iraola manages Liverpool, and the shootout went to sudden death.</p>")
HALLUCINATED = GOOD.replace("<p>Andoni Iraola manages Liverpool, and the shootout went to sudden death.</p>",
                            "<p>Alonso and Iraola are former Liverpool teammates who have known each other since childhood.</p>")


def verdict(text):
    return lambda prompt, max_tokens, temperature=0: llm.ChatResult(text + "\n===END===", "stop")


# ---------------------------------------------------------------- local grounding
def test_supported_article_passes_local_check():
    hard, unseen = factcheck.grounding_problems(ENTRY["title"], ENTRY["text"], post(GOOD))
    assert hard == [] and unseen == []


def test_invented_number_and_quote_are_hard_failures():
    bad = GOOD + '<p>He added: "we will win the Premier League this year" and 70,000 fans watched.</p>'
    hard, _ = factcheck.grounding_problems(ENTRY["title"], ENTRY["text"], post(bad))
    assert any("numbers not in the source" in h and "70000" in h for h in hard)
    assert any("quotation" in h for h in hard)


def test_quote_that_is_in_the_source_is_allowed():
    ok = GOOD + '<p>He said his players showed "great composure" on the night.</p>'
    hard, _ = factcheck.grounding_problems(ENTRY["title"], ENTRY["text"] + ' "his players showed great composure"', post(ok))
    assert not any("quotation" in h for h in hard)


def test_many_invented_names_fail_even_without_llm(monkeypatch):
    monkeypatch.setenv("FACTCHECK_MODE", "strict")
    bad = GOOD + "<p>Reporters from Madrid and Barcelona saw Kylian Mbappe and Pedri in the stands.</p>"
    problems = factcheck.verify(ENTRY, post(bad), use_llm=False)
    assert any("names not in the source" in p for p in problems)


# -------------------------------------------------------------------- LLM check
def test_llm_check_catches_the_invented_teammates_claim():
    """The exact failure from the Chelsea article: names are all real in the source, the RELATIONSHIP is made up."""
    out = factcheck.verify(ENTRY, post(HALLUCINATED), use_llm=True, chat=verdict(
        "VERDICT: FAIL\nUNSUPPORTED:\n- Alonso and Iraola are former Liverpool teammates who have known each other since childhood"))
    assert out and "teammates" in out[0]


def test_llm_check_passes_a_supported_article():
    assert factcheck.verify(ENTRY, post(GOOD), use_llm=True, chat=verdict("VERDICT: PASS\nUNSUPPORTED:\n- none")) == []


def test_pass_verdict_that_still_lists_a_claim_is_treated_as_fail():
    out = factcheck.verify(ENTRY, post(GOOD), use_llm=True, chat=verdict("VERDICT: PASS\nUNSUPPORTED:\n- he is Spanish"))
    assert out == ["he is Spanish"]


@pytest.mark.parametrize("res", [llm.ChatResult("VERDICT: PASS\nUNSUPPORTED:\n- none", "length"),   # cut off
                                 llm.ChatResult("looks fine to me\n===END===", "stop")], ids=["cut-off", "malformed"])
def test_unverifiable_means_not_published_in_strict_mode(res, monkeypatch):
    monkeypatch.setenv("FACTCHECK_MODE", "strict")
    with pytest.raises(Incomplete):
        factcheck.verify(ENTRY, post(GOOD), use_llm=True, chat=lambda *a, **k: res)


@pytest.mark.parametrize("res", [llm.ChatResult("VERDICT: PASS\nUNSUPPORTED:\n- none", "length"),
                                 llm.ChatResult("looks fine to me\n===END===", "stop")], ids=["cut-off", "malformed"])
def test_balanced_mode_keeps_the_article_on_the_local_check_when_the_second_call_cannot_finish(res, monkeypatch):
    monkeypatch.setenv("FACTCHECK_MODE", "balanced")
    assert factcheck.verify(ENTRY, post(GOOD), use_llm=True, chat=lambda *a, **k: res) == []


def test_cut_off_check_is_asked_again_once_with_double_the_room_and_a_real_fail_still_blocks(monkeypatch):
    monkeypatch.setenv("FACTCHECK_MODE", "balanced")
    budgets = []
    def chat(p, mt, temperature=0):
        budgets.append(mt)
        return llm.ChatResult("VERDICT: PASS\nUNSUPPORTED:\n- none", "length") if len(budgets) == 1 else \
            llm.ChatResult("VERDICT: FAIL\nUNSUPPORTED:\n- he resigned last year\n===END===", "stop")
    out = factcheck.verify(ENTRY, post(GOOD), use_llm=True, chat=chat)
    assert budgets == [factcheck.VERIFY_MAX_TOKENS, 2 * factcheck.VERIFY_MAX_TOKENS] and out == ["he resigned last year"]


def test_llm_call_is_skipped_when_local_check_already_failed():
    calls = []
    factcheck.verify(ENTRY, post(GOOD + "<p>Attendance was 70,000.</p>"), use_llm=True,
                     chat=lambda *a, **k: calls.append(1))
    assert calls == []


# --------------------------------------------------------------------- sections
def test_resolve_sections():
    assert schema.resolve_sections(["sport"], "world") == ["sport"]
    assert schema.resolve_sections(["Sport", "Europe", "Culture", "tech"], "world") == ["sport", "europe", "culture"]   # cap 3
    assert schema.resolve_sections(["world", "politics"], "world") == ["politics", "world"]      # catch-all never primary
    assert schema.resolve_sections(["Middle East", "Health & Science"], "world") == ["middle-east", "health-and-science"]
    assert schema.resolve_sections(["football", "banana"], "business") == ["business"]            # nothing valid -> feed section
    assert schema.resolve_sections([], "tech") == ["tech"]
    assert schema.resolve_sections(["sport", "sport"], "x") == ["sport"]


def test_every_pick_the_prompt_offers_is_a_real_ui_section():
    menu = rewriter._section_menu().splitlines()
    assert len(menu) == len(schema.SECTIONS) and all(l.split()[0] in schema.SECTION_BY_SLUG for l in menu)


def test_rewriter_returns_the_models_sections_and_tells_it_the_menu():
    seen = {}

    def chat(prompt, max_tokens, temperature=0):
        seen.update(prompt=prompt, temperature=temperature)
        body = "<p>" + "Chelsea won on penalties at Anfield. " * 30 + "</p>" * 1
        body = "".join(f"<p>{'Chelsea won on penalties at Anfield. ' * 8}</p>" for _ in range(4))
        return llm.ChatResult("REAL_NEWS_ARTICLE: yes\nTITLE: Chelsea win a League Cup shootout at Anfield\nEXCERPT: Chelsea won the shootout 6-5 at Anfield in the League Cup.\n"
                              "SUMMARY1: Chelsea won 6-5 on penalties at Anfield.\nSUMMARY2: The tie had finished 1-1 after normal time.\n"
                              "SUMMARY3: Xabi Alonso praised the composure of his players.\nIMPORTANCE: 40\nSECTIONS: sport, europe\n"
                              f"BODY:\n{body}\n===END===", "stop")
    art = {"title": "x", "url": "u", "text": "word " * 300, "images": ["https://i.example.com/a.jpg"], "source": "A"}
    out = rewriter.rewrite_article(art, chat=chat)
    assert out["sections"] == ["sport", "europe"]
    assert "  sport — Sport:" in seen["prompt"] and "Judge\nby what the story is ABOUT" in seen["prompt"]
    assert seen["temperature"] <= 0.5


# ------------------------------------------------------------- whole pipeline
@pytest.fixture
def st():
    s = MongoStorage(client=mongomock.MongoClient(), db_name="fc")
    s.ensure_ready()
    return s


def run_one(st, rewrites, verifier_results, feed_section="world"):
    rw = iter(rewrites)
    vr = iter(verifier_results)
    calls = {"feedback": []}

    def rewrite(e, voice=None, feedback=None):
        calls["feedback"].append(feedback)
        return next(rw)
    return generate.process_entry(dict(ENTRY), feed_section, st, SeenIndex(), rewrite=rewrite,
                                  verify=lambda e, p: next(vr)), calls


def test_football_story_from_a_world_feed_is_filed_by_content_with_multiple_sections(st, monkeypatch):
    monkeypatch.setattr(generate, "hydrate_entry", lambda e: e)
    art, _ = run_one(st, [post(GOOD, sections=("sport", "europe"))], [[]], feed_section="world")
    assert art["section"] == "sport" and art["sections"] == ["sport", "europe"] and art["tag"] == "Sport"
    stored = st.articles.find_one({"id": art["id"]})
    assert stored["sections"] == ["sport", "europe"]


def test_missing_section_pick_falls_back_to_the_feed_section(st, monkeypatch):
    monkeypatch.setattr(generate, "hydrate_entry", lambda e: e)
    art, _ = run_one(st, [post(GOOD, sections=())], [[]], feed_section="tech")
    assert art["sections"] == ["tech"]


def test_hallucinated_draft_is_rewritten_with_feedback_then_published(st, monkeypatch):
    monkeypatch.setattr(generate, "hydrate_entry", lambda e: e)
    claim = "Alonso and Iraola are former Liverpool teammates"
    art, calls = run_one(st, [post(HALLUCINATED), post(GOOD)], [[claim], []])
    assert calls["feedback"] == [None, [claim]]
    assert "teammates" not in art["html_body"] and st.articles.count_documents({}) == 1


def test_still_hallucinating_after_all_corrections_is_not_published(st, monkeypatch):
    monkeypatch.setattr(generate, "hydrate_entry", lambda e: e)
    claim = "Alonso and Iraola are former Liverpool teammates"
    with pytest.raises(generate.FailedFactCheck):
        run_one(st, [post(HALLUCINATED)] * 9, [[claim]] * 9)                 # 1 draft + 8 corrections, every one rejected
    assert st.articles.count_documents({}) == 0


def test_fact_check_is_corrected_over_several_rounds_not_abandoned_after_one(st, monkeypatch):
    monkeypatch.setattr(generate, "hydrate_entry", lambda e: e)
    claim = "Alonso and Iraola are former Liverpool teammates"
    art, calls = run_one(st, [post(HALLUCINATED)] * 5 + [post(GOOD)], [[claim]] * 5 + [[]])
    assert art["title"] and st.articles.count_documents({}) == 1
    assert len(calls["feedback"]) == 6 and calls["feedback"][0] is None and calls["feedback"][5] == [claim]


def test_validate_rejects_bad_sections():
    good = schema.build_article(title="A long enough title here", excerpt="An excerpt that is long enough to pass.",
                                summary=["a"], html_body="<p>One.</p><p>Two.</p><p>Three.</p>", section_slug="sport",
                                section_slugs=["sport", "europe"], hashtags=["#Sport"], img="https://i.example.com/a.jpg",
                                source_name="A", source_url="https://a.example.com/1", voice="Explainer", published_at=None)
    assert schema.validate_article(good)
    for bad in (["europe", "sport"], ["sport", "sport"], ["sport", "nope"], [], ["sport", "europe", "asia", "africa"]):
        with pytest.raises(ValueError):
            schema.validate_article({**good, "sections": bad})


# ------------------------------------------------- live sections from the database
@pytest.fixture
def restore_sections():
    saved = [dict(s) for s in schema.SECTIONS]
    yield
    schema.load_sections(saved)


def test_sections_come_from_the_database_not_the_json_file(restore_sections):
    s = MongoStorage(client=mongomock.MongoClient(), db_name="live")
    extra = ["football", "motorsport", "ai", "uk", "markets"]
    s.ensure_ready()                                         # first run seeds from sections.json
    for slug in extra:
        s.sections.insert_one({"slug": slug, "name": slug.title() if slug != "ai" else "AI", "desc": "", "tags": []})
    n = s.load_sections()
    assert n == len(schema.SECTION_BY_SLUG) and {"football", "ai", "uk"} <= set(schema.SECTION_BY_SLUG)
    assert schema.resolve_sections(["Football", "sport"], "world") == ["football", "sport"]
    assert schema.SECTION_BY_SLUG["ai"]["tags"] == ["AI"]                       # no tags in the db -> the name
    assert "  football — Football" in rewriter._section_menu()                  # the writer is offered them


def test_removed_sections_are_not_re_added_and_a_removed_feed_section_falls_back(restore_sections):
    s = MongoStorage(client=mongomock.MongoClient(), db_name="live2")
    s.ensure_ready()
    s.sections.delete_one({"slug": "weather"})
    s.ensure_ready()                                         # must NOT resurrect it
    assert s.sections.count_documents({"slug": "weather"}) == 0 and "weather" not in schema.SECTION_BY_SLUG
    assert schema.resolve_sections([], "weather") == ["world"]


# ------------------------------------------------ number formats from other locales / K-M labels
def plain_post(body):
    p_ = post(body, excerpt="A plain teaser sentence for the test.")
    p_["summary"] = ["A plain first takeaway sentence here.", "A plain second takeaway sentence here.", "A plain third takeaway sentence here."]
    p_["title"] = "A plain headline for the test"
    return p_


def test_thousands_separators_in_any_locale_match_each_other():
    src = "Más de 20.000 personas y 5 000 coches; 1,234,567 visitas."
    post_ = plain_post('<p>Over 20,000 people, 5,000 cars and 1.234.567 visits were counted.</p>')
    hard, _ = factcheck.grounding_problems("t", src, post_)
    assert not any("numbers" in h for h in hard), hard


def test_search_volume_label_5k_allows_5000():
    hard, _ = factcheck.grounding_problems("t", "Trending: 5K+ searches", plain_post('<p>More than 5,000 searches were counted.</p>'))
    assert not any("numbers" in h for h in hard)
    hard, _ = factcheck.grounding_problems("t", "Trending: 5K+ searches", plain_post('<p>More than 6,000 searches were counted.</p>'))
    assert any("6000" in h for h in hard)


def test_title_case_subheadings_are_not_flagged_as_invented_names():
    p_ = post(GOOD + "<h3>Legal History and Background</h3>")
    hard, unseen = factcheck.grounding_problems(ENTRY["title"], ENTRY["text"], p_)
    assert hard == [] and "Legal" not in unseen and "Background" not in unseen


# ------------------------------------------------ quotation punctuation is not a fabrication
def test_quote_with_different_closing_punctuation_or_dash_still_matches():
    src = 'He said "those who have nothing to hide have nothing to fear," and added the "mushroom murders ‐ there’s more to unearth" line.'
    ok = plain_post('<p>He said "those who have nothing to hide have nothing to fear." Another "mushroom murders: there\'s more to unearth," he noted.</p>')
    hard, _ = factcheck.grounding_problems("t", src, ok)
    assert not any("quotation" in h for h in hard), hard


def test_quote_with_changed_words_or_a_bad_ellipsis_piece_is_still_caught():
    src = 'He said "those who have nothing to hide have nothing to fear" on Monday.'
    changed = plain_post('<p>He said "those who have nothing to hide should fear nothing" on Monday.</p>')
    assert any("quotation" in h for h in factcheck.grounding_problems("t", src, changed)[0])
    ell_ok = plain_post('<p>He said "those who have nothing ... have nothing to fear" on Monday.</p>')
    assert not any("quotation" in h for h in factcheck.grounding_problems("t", src, ell_ok)[0])
    ell_bad = plain_post('<p>He said "those who have nothing ... will never be safe again" on Monday.</p>')
    assert any("quotation" in h for h in factcheck.grounding_problems("t", src, ell_bad)[0])


# ------------------------------------------------ strictness modes
QSRC = 'He said "those who have nothing to hide have nothing to fear" on Monday in Rome.'


def _qpost():
    return plain_post('<p>He said "those who have nothing to hide should fear nothing" on Monday in Rome.</p>')


def test_balanced_mode_removes_quote_marks_instead_of_losing_the_article(monkeypatch):
    monkeypatch.setenv("FACTCHECK_MODE", "balanced")
    p_ = _qpost()
    assert factcheck.verify({"title": "t", "text": QSRC}, p_, use_llm=False) == []
    assert '"' not in p_["html_body"] and "should fear nothing" in p_["html_body"]      # kept as paraphrase, no quote marks


def test_balanced_mode_keeps_real_quotes_and_still_blocks_invented_numbers(monkeypatch):
    monkeypatch.setenv("FACTCHECK_MODE", "balanced")
    ok = plain_post('<p>He said "those who have nothing to hide have nothing to fear" on Monday in Rome.</p>')
    assert factcheck.verify({"title": "t", "text": QSRC}, ok, use_llm=False) == [] and '"those who' in ok["html_body"]
    bad = plain_post('<p>He said it on Monday in Rome before 5000 people.</p>')
    assert any("numbers" in x for x in factcheck.verify({"title": "t", "text": QSRC}, bad, use_llm=False))


def test_strict_mode_still_blocks_a_bad_quote(monkeypatch):
    monkeypatch.setenv("FACTCHECK_MODE", "strict")
    assert any("quotation" in x for x in factcheck.verify({"title": "t", "text": QSRC}, _qpost(), use_llm=False))


def test_light_mode_ignores_names_and_quotes_but_not_numbers(monkeypatch):
    monkeypatch.setenv("FACTCHECK_MODE", "light")
    p_ = plain_post('<p>Zorblax Quendar met Pellin Vossk and Harn Telmoor in Rome, said "something completely different here".</p>')
    assert factcheck.verify({"title": "t", "text": QSRC}, p_, use_llm=False) == []
    assert factcheck.verify({"title": "t", "text": QSRC}, plain_post("<p>It drew 9000 people to Rome.</p>"), use_llm=False)
