"""Делает пакет `app` импортируемым в тестах api/ (pytest запускается из корня репо)."""
import sys
from pathlib import Path

_API_DIR = Path(__file__).resolve().parents[1]   # .../api
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))
