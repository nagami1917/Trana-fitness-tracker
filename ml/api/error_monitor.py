"""Uncaught-exception capture for the ML API.

Every unhandled fault is

1. written to stderr as one grep-able JSON line (``ERROR_MONITOR {…}``) —
   plain stdout/stderr is what Render / Railway / Cloud Run already ship to
   their log viewers, so this works with zero infrastructure, and
2. optionally forwarded to the Laravel intake
   (``ERROR_REPORT_ENDPOINT``) so it lands in the same ``error_logs``
   table as backend and browser faults, kind = ``ml``.

Forwarding is best-effort with a 1-second budget and never raises:
monitoring must not delay or break a prediction.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import traceback
import urllib.request
from typing import Any, Callable

from fastapi import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

MAX_MESSAGE = 1000
MAX_STACK = 4000


def _clip(value: str, limit: int) -> str:
    value = value.strip()
    if len(value) <= limit:
        return value
    return value[: limit - 1] + "…"


def _origin(exc: BaseException) -> str:
    """First traceback frame outside this module (the actual fault site)."""
    for frame in reversed(traceback.extract_tb(exc.__traceback__)):
        if "error_monitor" in frame.filename:
            continue
        return f"{frame.filename}:{frame.lineno}"
    return f"{type(exc).__name__}"


def build_payload(exc: BaseException, path: str, duration_ms: float) -> dict[str, Any]:
    """Client-contract payload (same fields POST /api/client-errors accepts)."""
    stack = _clip("".join(traceback.format_exception(exc)), MAX_STACK)
    return {
        "kind": "ml",
        "message": _clip(f"{type(exc).__name__}: {exc}", MAX_MESSAGE),
        "stack": stack,
        "route": _clip(path, 200),
        "app_version": os.getenv("ML_VERSION", "dev"),
        "fingerprint": hashlib.sha1(
            f"{type(exc).__name__}|{exc}|{_origin(exc)}".encode("utf-8", "replace")
        ).hexdigest(),
        "duration_ms": round(duration_ms, 1),
    }


def emit(payload: dict[str, Any]) -> None:
    """One stderr line, parseable by log-based alerting (Grep → alert)."""
    print(
        "ERROR_MONITOR " + json.dumps(payload, ensure_ascii=False),
        file=sys.stderr,
        flush=True,
    )


def forward(payload: dict[str, Any]) -> None:
    """Best-effort POST to the Laravel intake when configured."""
    endpoint = os.getenv("ERROR_REPORT_ENDPOINT", "").strip()
    if not endpoint:
        return

    body = json.dumps({k: payload[k] for k in ("kind", "message", "stack", "route", "app_version") if k in payload}).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=1.0):  # noqa: S310 - operator-configured endpoint
            pass
    except Exception:  # noqa: BLE001 - monitoring must never raise
        pass


async def dispatch(request: Request, call_next: Callable) -> Any:
    started = time.monotonic()
    try:
        return await call_next(request)
    except Exception as exc:
        # Deliberate 4xx protocol answers are not server faults.
        if isinstance(exc, HTTPException) and exc.status_code < 500:
            raise
        payload = build_payload(exc, request.url.path, (time.monotonic() - started) * 1000)
        try:
            emit(payload)
            forward(payload)
        except Exception:  # noqa: BLE001 - absolutely never mask the real error
            pass
        raise


def install_error_monitor(app) -> None:
    """Attach the monitor. Must be called BEFORE CORS so the CORS middleware
    ends up outermost (Starlette wraps later-added middleware around earlier)."""
    app.add_middleware(BaseHTTPMiddleware, dispatch=dispatch)
