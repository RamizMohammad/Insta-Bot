"""Write the OpenAPI schema to docs/openapi.json:  uv run python scripts/export_openapi.py"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.main import create_app  # noqa: E402

OUT = ROOT / "docs" / "openapi.json"

if __name__ == "__main__":
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(create_app().openapi(), indent=2) + "\n")
    print(f"wrote {OUT}")
