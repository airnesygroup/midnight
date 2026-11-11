"""The LLM fact-check makes a real API call; keep it off in the offline suite unless a test turns it on."""
import pytest


@pytest.fixture(autouse=True)
def _no_llm_factcheck(monkeypatch):
    monkeypatch.setenv("FACTCHECK_LLM", "off")
