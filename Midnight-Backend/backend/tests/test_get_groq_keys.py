"""Logic tests for get_groq_keys.py with a tiny fake browser (no Chrome, no network)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import get_groq_keys as g

KEY = "gsk_" + "AbCdEf0123456789" * 3


class El:
    def __init__(self, text="", value="", on_click=None):
        self.text, self.value, self.on_click = text, value, on_click
        self.typed = ""

    def is_displayed(self): return True
    def is_enabled(self): return True
    def click(self):
        if self.on_click:
            self.on_click()
    def clear(self): self.value = ""
    def send_keys(self, s): self.value += s; self.typed = self.value
    def get_attribute(self, n): return self.value if n == "value" else None


class FakeDriver:
    """A 'keys' page: Create button -> dialog with a text box and Submit -> the key appears in a read-only input."""
    def __init__(self, working=True, key=KEY):
        self.working, self.key, self.dialog, self.revealed, self.url = working, key, False, False, None
        self.box = El()
        self.create = El("Create API Key", on_click=lambda: setattr(self, "dialog", True))
        self.submit = El("Submit", on_click=self._submit)
        self.keyout = El()

    def _submit(self):
        if self.box.value:
            self.revealed, self.keyout.value = True, self.key

    def get(self, url): self.url = url

    @property
    def page_source(self): return f"<html>{self.keyout.value}</html>" if self.revealed else "<html></html>"

    def find_elements(self, by, sel):
        if "type=text" in sel:
            return [self.box] if self.dialog else []
        if "input, textarea" in sel:
            return [self.keyout] if self.revealed else []
        if sel.startswith("//button") and self.working:
            if "'Create API Key'" in sel and not self.dialog:
                return [self.create]
            if "'Submit'" in sel and self.dialog:
                return [self.submit]
        return []


def test_read_emails_ignores_comments_blanks_bad_lines_and_duplicates(tmp_path):
    f = tmp_path / "e.txt"
    f.write_text("# my accounts\nA@x.com\n\n b@y.org  # work\nnot-an-email\na@x.com,\n", encoding="utf-8")
    assert g.read_emails(str(f)) == ["a@x.com", "b@y.org"]


def test_key_is_found_in_inputs_and_known_keys_are_ignored():
    d = FakeDriver(); d.revealed = True; d.keyout.value = KEY
    assert g.find_key(d) == KEY
    assert g.find_key(d, known={KEY}) is None


def test_create_flow_clicks_names_confirms_and_captures_the_key():
    d = FakeDriver()
    k = g.create_key(d, "midnight-01", known=set(), wait=5, say=lambda *_: None, sleep=lambda s: None)
    assert k == KEY and d.box.typed == "midnight-01" and d.url == g.KEYS_URL


def test_when_buttons_are_not_found_it_keeps_watching_so_a_manual_click_still_works():
    d = FakeDriver(working=False)
    ticks = {"n": 0}

    def sleep(_):
        ticks["n"] += 1
        if ticks["n"] == 6:                      # the human creates the key in the real browser window
            d.revealed, d.keyout.value = True, KEY
    clock = iter(range(0, 10_000)).__next__
    msgs = []
    k = g.create_key(d, "n", known=set(), wait=5, manual_wait=50, say=msgs.append, sleep=sleep, clock=lambda: clock())
    assert k == KEY and any("yourself" in m for m in msgs)


def test_gives_up_with_none_not_a_crash_if_no_key_ever_appears():
    d = FakeDriver(working=False)
    clock = iter(range(0, 10_000)).__next__
    assert g.create_key(d, "n", known=set(), wait=2, manual_wait=5, say=lambda *_: None, sleep=lambda s: None, clock=lambda: clock()) is None


def test_csv_resume_and_env_line(tmp_path):
    out = tmp_path / "keys.csv"
    g.save_row(str(out), "a@x.com", "midnight-01", KEY)
    g.save_row(str(out), "b@y.org", "midnight-02", KEY.replace("AbCd", "ZyXw"))
    assert {r["email"] for r in g.load_rows(str(out))} == {"a@x.com", "b@y.org"}
    txt = tmp_path / "k.txt"
    assert g.write_env_line(str(out), str(txt)) == 2
    line = txt.read_text().strip()
    assert line.startswith("GROQ_API_KEYS=gsk_") and line.count(",") == 1


# ------------------------------------------------------------ sign-up automation
class SignupDriver:
    """Sign-up page: an email box and a Continue button. After Continue it waits for a link/code from the 'inbox'."""
    def __init__(self, email_box=True, button=True, url="https://console.groq.com/login"):
        self.url, self.visited = url, []
        self.box = El()
        self.submitted = False
        self.cont = El("Continue", on_click=lambda: setattr(self, "submitted", True))
        self.has_box, self.has_button = email_box, button

    @property
    def current_url(self): return self.url

    def get(self, url):
        self.visited.append(url)
        self.url = "https://console.groq.com/playground" if "verify-token" in url else url

    def find_elements(self, by, sel):
        if "input[type=email]" in sel and self.has_box:
            return [self.box]
        if sel.startswith("//button") and self.has_button and "'Continue'" in sel and not self.submitted:
            return [self.cont]
        return []


def test_signup_types_the_address_and_clicks_continue():
    d = SignupDriver()
    assert g.start_signup(d, "me@example.com", say=lambda *_: None, sleep=lambda s: None)
    assert d.box.typed == "me@example.com" and d.submitted and d.visited == [g.SIGNUP_URL]


def test_signup_says_so_instead_of_crashing_when_the_page_has_no_email_box():
    msgs = []
    assert not g.start_signup(SignupDriver(email_box=False), "me@example.com", say=msgs.append, sleep=lambda s: None)
    assert any("email box" in m for m in msgs)


def test_signed_in_means_a_console_page_that_is_not_login_or_verification():
    d = SignupDriver()
    assert not g.signed_in(d)                                          # still on /login
    d.url = "https://console.groq.com/verify?x=1"
    assert not g.signed_in(d)
    d.url = "https://console.groq.com/playground"
    assert g.signed_in(d)
    d.url = "https://accounts.google.com/x"
    assert not g.signed_in(d)


def test_pasting_the_emailed_link_signs_the_window_in():
    d = SignupDriver()
    ok = g.finish_verification(d, ask=lambda _: "https://console.groq.com/verify-token?abc", say=lambda *_: None,
                               sleep=lambda s: None, timeout=5)
    assert ok and d.visited[-1].startswith("https://console.groq.com/verify-token")


def test_typing_a_code_in_the_window_instead_just_needs_enter():
    d = SignupDriver()
    d.url = "https://console.groq.com/playground"                      # the human typed the code; the page moved on
    visited_before = list(d.visited)
    assert g.finish_verification(d, ask=lambda _: "", say=lambda *_: None, sleep=lambda s: None, timeout=5)
    assert d.visited == visited_before                                 # nothing was navigated away from


def test_not_signed_in_in_time_is_reported_not_hung():
    d = SignupDriver()
    clock = iter(range(0, 10_000)).__next__
    msgs = []
    assert not g.finish_verification(d, ask=lambda _: "", say=msgs.append, sleep=lambda s: None, clock=lambda: clock(), timeout=3)
    assert msgs
