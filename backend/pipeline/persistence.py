import json
import logging
from pathlib import Path
from typing import List, Dict

CHATS_FILE = Path(__file__).parent.parent / "data" / "chats.json"
CHATS_FILE.parent.mkdir(parents=True, exist_ok=True)

def load_chats() -> List[Dict]:
    """Load chat history from JSON file."""
    if CHATS_FILE.exists():
        try: return json.loads(CHATS_FILE.read_text(encoding="utf-8"))
        except Exception: return []
    return []

def save_chats(chats: List[Dict]):
    """Save chat history to JSON file."""
    CHATS_FILE.write_text(json.dumps(chats, indent=2, ensure_ascii=False), encoding="utf-8")
