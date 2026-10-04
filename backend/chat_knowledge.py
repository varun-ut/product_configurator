import json
from pathlib import Path

_CHATBOT_DIR = Path(__file__).parent / "chatbot-files"

def _read(filename: str) -> str:
    return (_CHATBOT_DIR / filename).read_text(encoding="utf-8")

_system_prompt_text = _read("system_prompt.md")
_knowledge_base = _read("univicoustic_knowledge_base.json")
_faqs = _read("univicoustic_faqs.json")
_selector_flow = _read("selector_flow.json")

SYSTEM_PROMPT = f"""{_system_prompt_text}

---
KNOWLEDGE BASE (authoritative — all product facts must come from here):
{_knowledge_base}

---
FAQ ANSWER BANK (prefer these exact answers when the question matches):
{_faqs}

---
SELECTOR FLOW (use when user asks "which panel should I pick"):
{_selector_flow}"""
