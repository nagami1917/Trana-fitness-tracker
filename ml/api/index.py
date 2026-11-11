"""Vercel serverless entry point for the TRANA ML API.

Vercel turns every `api/*.py` file into a Python function and expects an
ASGI callable named `app`. The FastAPI application itself lives in
`api/main.py`; this shim only repairs the import path, because the function
is loaded as a top-level module — the repository root (`ml/`) has to be on
`sys.path` before `api.main` and the model packages can be imported.

Local development is unchanged: `uvicorn api.main:app --port 8000`.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.main import app  # noqa: E402  (path fix must run before the import)

__all__ = ["app"]
