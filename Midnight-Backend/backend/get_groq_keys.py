"""
Sign up your own email addresses on Groq and collect one API key per account, with as little clicking as possible.

    pip install selenium            (Chrome must be installed; Selenium 4.6+ fetches its own chromedriver)
    python get_groq_keys.py         (reads emails.txt, one address per line)

What is automatic, per address: a fresh, empty Chrome opens (own profile, accounts never mix), goes to the Groq sign-up
page, types the address and clicks Continue. With --batch N (default 5) that is done for N addresses at once, so N
verification emails are already waiting in your inboxes.

What stays with you (about 10 seconds each): Groq emails every new account a verification link or code, and this script
does not read inboxes or get around that check. Open the email, then EITHER paste the link into this terminal and press
Enter, OR (for a code) type the code into that Chrome window and just press Enter here.

Then automatic again: the script waits until the window is signed in, opens the API keys page, clicks "Create API Key",
types the key name, confirms, reads the key the moment it appears (a key is shown only once) and saves it.

If a button is not found, or Groq changed its page, the script does not give up: do that step yourself in the open window
and the key is still picked up (the script watches the page for anything that looks like a gsk_ key).

Output, next to this script:
    groq_keys.csv        email, key name, key, time   (appended; rerunning skips emails that already have a key)
    groq_api_keys.txt    GROQ_API_KEYS=gsk_...,gsk_...  <- paste this line into backend/.env

Options:  --emails FILE  --out FILE  --name-prefix midnight  --batch 5  --limit N  --wait SECONDS  --headless (testing only)
Env:      GROQ_SIGNUP_URL, GROQ_KEYS_URL (defaults below), CHROME_BIN, CHROMEDRIVER
Keys are secrets. Do not commit groq_keys.csv (it is git-ignored by name in this repo's .gitignore).
"""
import argparse
import csv
import os
import re
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SIGNUP_URL = os.environ.get("GROQ_SIGNUP_URL", os.environ.get("GROQ_LOGIN_URL", "https://console.groq.com/login"))
KEYS_URL = os.environ.get("GROQ_KEYS_URL", "https://console.groq.com/keys")
KEY_RE = re.compile(r"gsk_[A-Za-z0-9]{30,}")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CREATE_TEXTS = ("Create API Key", "Create API key", "Create Key", "Create key", "New API Key")
CONTINUE_TEXTS = ("Continue with email", "Continue", "Sign up", "Next", "Send", "Get started")
CONFIRM_TEXTS = ("Submit", "Create", "Create API Key", "Create API key", "Create Key", "Save")


# ------------------------------------------------------------------ files
def read_emails(path):
    """Addresses from a text file: one per line, blank lines and #-comments ignored, duplicates dropped."""
    out, seen = [], set()
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            e = line.split("#", 1)[0].strip().strip(",;").lower()
            if not e:
                continue
            if not EMAIL_RE.match(e):
                print(f"  ! skipping, not an email address: {e!r}")
                continue
            if e not in seen:
                seen.add(e)
                out.append(e)
    return out


def load_rows(csv_path):
    if not os.path.exists(csv_path):
        return []
    with open(csv_path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_row(csv_path, email, name, key):
    new = not os.path.exists(csv_path)
    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["email", "name", "key", "created_at"])
        w.writerow([email, name, key, datetime.now(timezone.utc).isoformat(timespec="seconds")])


def write_env_line(csv_path, txt_path):
    keys = list(dict.fromkeys(r["key"] for r in load_rows(csv_path) if r.get("key")))
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("GROQ_API_KEYS=" + ",".join(keys) + "\n")
    return len(keys)


# ---------------------------------------------------------------- browser
def new_driver(profile_dir, headless=False):
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    o = Options()
    o.add_argument(f"--user-data-dir={profile_dir}")
    o.add_argument("--no-first-run")
    o.add_argument("--no-default-browser-check")
    o.add_argument("--window-size=1200,900")
    o.add_experimental_option("excludeSwitches", ["enable-logging"])
    if os.environ.get("CHROME_BIN"):
        o.binary_location = os.environ["CHROME_BIN"]
    if headless:
        o.add_argument("--headless=new")
        o.add_argument("--no-sandbox")
    svc = Service(os.environ["CHROMEDRIVER"]) if os.environ.get("CHROMEDRIVER") else Service()
    return webdriver.Chrome(options=o, service=svc)


def find_key(driver, known=()):
    """A gsk_ key visible on the page (text, HTML or any input's value) that we have not seen before, or None."""
    from selenium.webdriver.common.by import By
    chunks = [driver.page_source or ""]
    try:
        for el in driver.find_elements(By.CSS_SELECTOR, "input, textarea, code, pre"):
            v = el.get_attribute("value") or el.text or ""
            if v:
                chunks.append(v)
    except Exception:  # noqa: BLE001 - page changing under us: next poll will see it
        pass
    for chunk in chunks:
        for k in KEY_RE.findall(chunk):
            if k not in known:
                return k
    return None


def _visible(els):
    out = []
    for e in els:
        try:
            if e.is_displayed() and e.is_enabled():
                out.append(e)
        except Exception:  # noqa: BLE001
            pass
    return out


def click_by_text(driver, texts, last=False):
    """Click a visible button/link whose text contains one of `texts`. Returns True if something was clicked."""
    from selenium.webdriver.common.by import By
    for t in texts:
        xp = (f"//button[contains(normalize-space(.), '{t}')] | //a[contains(normalize-space(.), '{t}')] | "
              f"//*[@role='button'][contains(normalize-space(.), '{t}')]")
        els = _visible(driver.find_elements(By.XPATH, xp))
        if els:
            try:
                (els[-1] if last else els[0]).click()
                return True
            except Exception:  # noqa: BLE001 - overlay, stale element...: try the next wording
                continue
    return False


def fill_name(driver, name):
    """Type the key name into the first empty visible text box (the 'Create API Key' dialog)."""
    from selenium.webdriver.common.by import By
    boxes = _visible(driver.find_elements(By.CSS_SELECTOR, "input[type=text], input:not([type]), input[type=search]"))
    boxes = [b for b in boxes if not (b.get_attribute("value") or "").strip()]
    if not boxes:
        return False
    box = boxes[-1]                       # a dialog's field is last in the document
    box.clear()
    box.send_keys(name)
    return True


def start_signup(driver, email, say=print, sleep=time.sleep):
    """Open the sign-up page, type the address and click Continue. Returns True if the address was submitted."""
    from selenium.webdriver.common.by import By
    driver.get(SIGNUP_URL)
    sleep(2)
    boxes = _visible(driver.find_elements(By.CSS_SELECTOR, "input[type=email], input[name=email], input[autocomplete=email]"))
    if not boxes:
        boxes = _visible(driver.find_elements(By.CSS_SELECTOR, "input[type=text], input:not([type])"))
    if not boxes and click_by_text(driver, ("Continue with email", "Sign up with email", "Email")):   # email form behind a button
        sleep(1)
        boxes = _visible(driver.find_elements(By.CSS_SELECTOR, "input[type=email], input[name=email], input[type=text], input:not([type])"))
    if not boxes:
        say("  ! could not find the email box; type the address into the window yourself.")
        return False
    boxes[0].clear()
    boxes[0].send_keys(email)
    if click_by_text(driver, CONTINUE_TEXTS):
        return True
    try:
        from selenium.webdriver.common.keys import Keys
        boxes[0].send_keys(Keys.ENTER)
        return True
    except Exception:  # noqa: BLE001
        say("  ! could not press Continue; do it in the window yourself.")
        return False


def signed_in(driver):
    """True once the window is on a console page that is not a login / sign-up / verification page."""
    try:
        url = (driver.current_url or "").lower()
    except Exception:  # noqa: BLE001
        return False
    if "groq.com" not in url and "localhost" not in url:
        return False
    return not any(w in url for w in ("login", "signup", "sign-up", "sign_up", "verify", "auth", "about:blank"))


def finish_verification(driver, ask=input, say=print, sleep=time.sleep, clock=time.monotonic, timeout=180):
    """You do the emailed check (paste the link here, or type the code in the window); this waits for the result."""
    link = (ask("  Verification email: paste the link here and press Enter, or type the code in the browser window "
                "and just press Enter ... ") or "").strip()
    if link.startswith("http"):
        driver.get(link)
    end = clock() + timeout
    while clock() < end:
        if signed_in(driver):
            return True
        sleep(1)
    say("  ! the window is not signed in yet (still on a login/verification page).")
    return False


def create_key(driver, name, known, wait=60, manual_wait=240, say=print, sleep=time.sleep, clock=time.monotonic):
    """Drive the 'create key' form, then watch the page for the key. Falls back to YOU clicking if needed."""
    driver.get(KEYS_URL)
    sleep(2)
    k = find_key(driver, known)                                  # (a key already on screen, e.g. right after creation)
    if k:
        return k
    opened = click_by_text(driver, CREATE_TEXTS)
    sleep(1)
    named = fill_name(driver, name) if opened else False
    confirmed = click_by_text(driver, CONFIRM_TEXTS, last=True) if opened else False
    if not (opened and confirmed):
        say("  ! could not find the create-key button by itself. Create the key in the browser window yourself; "
            "I am watching the page and will grab it.")
    end = clock() + (wait if opened and confirmed else manual_wait)
    while clock() < end:
        k = find_key(driver, known)
        if k:
            return k
        sleep(0.5)
    if opened and confirmed:                                     # automatic attempt timed out: give a manual window too
        say("  ! no key appeared yet. If the page asks for something, finish it in the browser; still watching.")
        end = clock() + manual_wait
        while clock() < end:
            k = find_key(driver, known)
            if k:
                return k
            sleep(0.5)
    return None


# ------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--emails", default=os.path.join(HERE, "emails.txt"))
    ap.add_argument("--out", default=os.path.join(HERE, "groq_keys.csv"))
    ap.add_argument("--name-prefix", default="midnight")
    ap.add_argument("--batch", type=int, default=5, help="sign-up windows opened at once (their emails arrive together)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N new keys (0 = all emails)")
    ap.add_argument("--wait", type=int, default=60, help="seconds to wait for the key after clicking create")
    ap.add_argument("--headless", action="store_true", help="no window (testing against a local mock page only)")
    ap.add_argument("--no-prompt", action="store_true", help="do not wait for you after sign-up (testing only)")
    a = ap.parse_args(argv)

    if not os.path.exists(a.emails):
        print(f"Create {a.emails} with one email address per line (see emails.txt.example).")
        return 2
    emails = read_emails(a.emails)
    done = {r["email"].lower() for r in load_rows(a.out)}
    known = {r["key"] for r in load_rows(a.out)}
    todo = [e for e in emails if e not in done]
    print(f"{len(emails)} address(es), {len(done & set(emails))} already have a key, {len(todo)} to do.")
    made = 0
    batch = max(1, a.batch)
    for b0 in range(0, len(todo), batch):
        chunk = todo[b0:b0 + batch]
        if a.limit and made >= a.limit:
            break
        opened = []                                          # (email, driver, profile)
        print(f"\nOpening {len(chunk)} sign-up window(s) and submitting the addresses ...")
        for email in chunk:
            profile = tempfile.mkdtemp(prefix="groqkeys_")
            try:
                driver = new_driver(profile, headless=a.headless)
                ok = start_signup(driver, email)
                print(f"  {email}: {'submitted' if ok else 'needs you to finish the form in its window'}")
                opened.append((email, driver, profile))
            except Exception as e:  # noqa: BLE001
                print(f"  ! {email}: {type(e).__name__}: {str(e)[:160]}")
                shutil.rmtree(profile, ignore_errors=True)
        for n, (email, driver, profile) in enumerate(opened, 1):
            if a.limit and made >= a.limit:
                break
            print(f"\n[{b0 + n}/{len(todo)}] {email}")
            try:
                if not a.no_prompt:
                    finish_verification(driver)
                name = f"{a.name_prefix}-{len(done) + made + 1:02d}"
                key = create_key(driver, name, known, wait=a.wait)
                if key:
                    known.add(key)
                    save_row(a.out, email, name, key)
                    made += 1
                    print(f"  saved key {name}: ...{key[-4:]}")
                else:
                    print("  ! no key captured for this account; run the script again to retry it.")
            except KeyboardInterrupt:
                print("\nStopped.")
                break
            except Exception as e:  # noqa: BLE001
                print(f"  ! {type(e).__name__}: {str(e)[:200]}")
            finally:
                try:
                    driver.quit()
                except Exception:  # noqa: BLE001
                    pass
                shutil.rmtree(profile, ignore_errors=True)   # fresh profile each time: no cookies carried over
        for email, driver, profile in opened:                # anything left open after an interrupt
            try:
                driver.quit()
            except Exception:  # noqa: BLE001
                pass
    total = write_env_line(a.out, os.path.join(os.path.dirname(os.path.abspath(a.out)), "groq_api_keys.txt"))
    print(f"\n{made} new key(s) this run, {total} in total. Paste the line in groq_api_keys.txt into backend/.env")
    return 0


if __name__ == "__main__":
    sys.exit(main())
