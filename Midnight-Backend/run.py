#!/usr/bin/env python3
"""
Single entry point for the whole app.

    python run.py

What it does:
  1. Creates a Python venv (backend/.venv) and installs backend deps, if needed
  2. Runs `npm install` in frontend/, if needed
  3. Starts the FastAPI backend on :8000
  4. Starts the Vite dev server on :5173 (proxies /api to the backend)
  5. Opens your browser

Ctrl+C stops both.

Optional:
    python run.py --generate 50     first publish 50 articles (one per source, in turn)
    python run.py --live            keep publishing new articles to MongoDB in the background,
                                    AND run the Midnight Trends loop (Google Trends) in parallel
    python run.py --live --no-trends   news only
    python run.py --live --no-watchdog start the loops directly, without the watchdog (old behaviour)

With --live the loops are started and kept alive by backend/watchdog.py, an independent service that restarts a
loop that crashed, froze or stopped making progress. You can also run it on its own:  python watchdog.py
"""

import argparse
import os
import platform
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")
VENV = os.path.join(BACKEND, ".venv")
IS_WIN = platform.system() == "Windows"

BIN = os.path.join(VENV, "Scripts" if IS_WIN else "bin")
PY = os.path.join(BIN, "python.exe" if IS_WIN else "python")
NPM = "npm.cmd" if IS_WIN else "npm"

procs = []

BACKEND_PORT = 8000
FRONTEND_PORT = 5173


def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def find_free_port(start, limit=20):
    """Returns the first free port at or after `start`."""
    for p in range(start, start + limit):
        if not port_in_use(p):
            return p
    fail(f"No free port found between {start} and {start + limit}.")


def pid_on_port(port):
    """Best-effort lookup of what is holding a port (macOS/Linux)."""
    try:
        out = subprocess.run(["lsof", "-ti", f":{port}"],
                             capture_output=True, text=True, timeout=5)
        pids = [p for p in out.stdout.strip().splitlines() if p]
        return pids
    except Exception:
        return []


def log(msg):
    print(f"\033[36m[run]\033[0m {msg}")


def fail(msg):
    print(f"\033[31m[error]\033[0m {msg}")
    sys.exit(1)


REQUIRED_MODULES = "fastapi, uvicorn, dotenv, requests, bs4, lxml, groq, pymongo, nh3, PIL"


def install_backend_deps():
    subprocess.run([PY, "-m", "pip", "install", "-q", "--upgrade", "pip"], check=False)
    r = subprocess.run([PY, "-m", "pip", "install", "-q", "--prefer-binary", "-r",
                        os.path.join(BACKEND, "requirements.txt")])
    if r.returncode != 0:
        fail("Installing the backend packages failed (see the error above). "
             "If it mentions building 'lxml' or another wheel, install a Python version with "
             "prebuilt wheels (3.11-3.13) from python.org, delete backend\\.venv and run again.")


def setup_backend():
    if not os.path.isdir(VENV):
        log("Creating Python virtualenv...")
        subprocess.run([sys.executable, "-m", "venv", VENV], check=True)
    # Always verify: a half-finished earlier install, or a new version that
    # needs new packages, is repaired here instead of crashing later.
    ok = subprocess.run([PY, "-c", f"import {REQUIRED_MODULES}"], capture_output=True).returncode == 0
    if ok:
        log("Backend packages OK.")
    else:
        log("Installing backend packages (a minute or two the first time)...")
        install_backend_deps()

    env_file = os.path.join(BACKEND, ".env")
    if not os.path.exists(env_file):
        shutil.copy(os.path.join(BACKEND, ".env.example"), env_file)
        log("Created backend/.env — add GROQ_API_KEY and MONGODB_URI there before generating posts.")


def setup_frontend():
    if not shutil.which(NPM):
        fail("npm not found. Install Node.js 18+ from https://nodejs.org and retry.")
    if not os.path.isdir(os.path.join(FRONTEND, "node_modules")):
        log("Installing frontend dependencies (this takes a minute)...")
        subprocess.run([NPM, "install"], cwd=FRONTEND, check=True)
    else:
        log("Frontend deps already installed.")


def start_backend(port):
    if port != BACKEND_PORT:
        pids = pid_on_port(BACKEND_PORT)
        hint = f" (held by PID {', '.join(pids)})" if pids else ""
        log(f"Port {BACKEND_PORT} is busy{hint} — using {port} instead.")
        if pids:
            log(f"To free it:  kill {' '.join(pids)}")
    log(f"Starting backend on http://localhost:{port}")
    p = subprocess.Popen(
        [PY, "-m", "uvicorn", "main:app", "--host", "127.0.0.1",
         "--port", str(port)],
        cwd=BACKEND,
        stdin=subprocess.DEVNULL,
    )
    procs.append(p)
    return p


def start_frontend(port, backend_port):
    log(f"Starting frontend on http://localhost:{port}")
    env = dict(os.environ)
    # vite.config.js reads these so the proxy follows a relocated backend.
    env["VITE_BACKEND_PORT"] = str(backend_port)
    env["VITE_PORT"] = str(port)
    p = subprocess.Popen(
        [NPM, "run", "dev", "--", "--port", str(port), "--strictPort"],
        cwd=FRONTEND,
        env=env,
        # Vite tries to read keyboard shortcuts from stdin. When stdin is not
        # an interactive TTY (piped, backgrounded, some terminals) that read
        # fails with EIO and crashes Node. Detaching stdin prevents it.
        stdin=subprocess.DEVNULL,
    )
    procs.append(p)
    return p


def open_browser(port):
    time.sleep(4)
    webbrowser.open(f"http://localhost:{port}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate", type=int, default=0,
                        help="Publish N articles (one per source in turn) to MongoDB before starting")
    parser.add_argument("--live", action="store_true",
                        help="Keep the pipeline running in the background, pushing each new article to MongoDB")
    parser.add_argument("--no-trends", action="store_true",
                        help="With --live: do not start the Midnight Trends loop (generate_trends.py)")
    parser.add_argument("--no-watchdog", action="store_true",
                        help="With --live: start the loops directly instead of through the watchdog")
    args = parser.parse_args()

    setup_backend()
    setup_frontend()

    if args.generate:
        log(f"Generating {args.generate} posts...")
        r = subprocess.run(
            [PY, "generate.py", "--count", str(args.generate)], cwd=BACKEND
        )
        if r.returncode != 0:
            log("Generation had errors — starting the app anyway.")

    pipeline = trends = watchdog = None
    if args.live and not args.no_watchdog:
        cmd = [PY, "watchdog.py"] + (["--only", "news"] if args.no_trends else [])
        log("Starting the watchdog: it starts the live loops and restarts them whenever one stops, freezes or stalls...")
        watchdog = subprocess.Popen(cmd, cwd=BACKEND, stdin=subprocess.DEVNULL)
    elif args.live:
        log("Starting the live pipeline in the background (Ctrl+C stops it too)...")
        pipeline = subprocess.Popen([PY, "generate.py", "--forever"], cwd=BACKEND, stdin=subprocess.DEVNULL)
        if not args.no_trends:
            log("Starting the Midnight Trends loop in the background (independent of the news loop)...")
            trends = subprocess.Popen([PY, "generate_trends.py", "--forever"], cwd=BACKEND, stdin=subprocess.DEVNULL)

    backend_port = find_free_port(BACKEND_PORT)
    frontend_port = find_free_port(FRONTEND_PORT)

    start_backend(backend_port)

    # Wait for the backend to actually accept connections before starting Vite.
    for _ in range(30):
        if port_in_use(backend_port):
            break
        time.sleep(0.4)
    else:
        log("Backend did not come up in time — check the errors above.")

    start_frontend(frontend_port, backend_port)
    threading.Thread(target=open_browser, args=(frontend_port,), daemon=True).start()

    print(f"\n  Dashboard running at \033[1mhttp://localhost:{frontend_port}\033[0m")
    print(f"  API at http://localhost:{backend_port}/api/status")
    print("  Press Ctrl+C to stop.\n")

    try:
        while True:
            time.sleep(1)
            for p in procs:
                if p.poll() is not None:
                    raise KeyboardInterrupt
            if watchdog is not None and watchdog.poll() is not None:
                log(f"The watchdog stopped (exit code {watchdog.returncode}); restarting it.")
                watchdog = subprocess.Popen(watchdog.args, cwd=BACKEND, stdin=subprocess.DEVNULL)
            if pipeline is not None and pipeline.poll() is not None:
                # The pipeline stopping (e.g. bad API key) must NOT take the dashboard down with it.
                log(f"The pipeline stopped (exit code {pipeline.returncode}). Read its message above. "
                    "The dashboard stays up; fix the problem, then press Ctrl+C and run again.")
                pipeline = None
            if trends is not None and trends.poll() is not None:
                # Same rule for the trends loop: it stopping must not take the news loop or dashboard down.
                log(f"The trends loop stopped (exit code {trends.returncode}). Read its message above. "
                    "The news loop and dashboard stay up; fix the problem, then press Ctrl+C and run again.")
                trends = None
    except KeyboardInterrupt:
        log("Shutting down...")
        if watchdog is not None:
            procs.append(watchdog)
        if pipeline is not None:
            procs.append(pipeline)
        if trends is not None:
            procs.append(trends)
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass
        for p in procs:
            try:
                p.wait(timeout=5)
            except Exception:
                p.kill()


if __name__ == "__main__":
    main()
