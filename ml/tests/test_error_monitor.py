"""Error-monitor tests for the ML API: capture, filter, forward.

    pip install -r requirements-dev.txt
    pytest -q tests/test_error_monitor.py
"""

from __future__ import annotations

import json

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api import error_monitor


def make_app() -> FastAPI:
    app = FastAPI()
    error_monitor.install_error_monitor(app)

    @app.get("/ok")
    def ok() -> dict:
        return {"status": "ok"}

    @app.get("/boom")
    def boom() -> None:
        raise ValueError("bad training row")

    @app.get("/missing")
    def missing() -> None:
        raise HTTPException(status_code=404, detail="nope")

    return app


def test_unhandled_exception_is_captured_and_still_returns_500(monkeypatch):
    emitted: list = []
    forwarded: list = []
    monkeypatch.setattr(error_monitor, "emit", emitted.append)
    monkeypatch.setattr(error_monitor, "forward", forwarded.append)

    client = TestClient(make_app(), raise_server_exceptions=False)
    response = client.get("/boom")

    assert response.status_code == 500
    assert len(emitted) == 1
    assert len(forwarded) == 1

    payload = emitted[0]
    assert payload["kind"] == "ml"
    assert "bad training row" in payload["message"]
    assert payload["route"] == "/boom"
    assert len(payload["fingerprint"]) == 40  # sha1 hex
    assert "ValueError" in payload["stack"]
    assert payload["duration_ms"] >= 0


def test_deliberate_4xx_answers_are_not_reported(monkeypatch):
    emitted: list = []
    monkeypatch.setattr(error_monitor, "emit", emitted.append)

    client = TestClient(make_app(), raise_server_exceptions=False)
    assert client.get("/missing").status_code == 404
    assert emitted == []


def test_healthy_requests_pass_through_untouched(monkeypatch):
    emitted: list = []
    monkeypatch.setattr(error_monitor, "emit", emitted.append)

    client = TestClient(make_app())
    assert client.get("/ok").json() == {"status": "ok"}
    assert emitted == []


def test_identical_faults_share_a_fingerprint():
    def fault() -> ValueError:
        return ValueError("same cause")

    first = error_monitor.build_payload(fault(), "/predict", 1.0)
    second = error_monitor.build_payload(fault(), "/predict/duration", 2.0)
    # Route is not part of the fingerprint: one cause, one group.
    assert first["fingerprint"] == second["fingerprint"]


def test_forward_posts_the_client_contract_when_configured(monkeypatch):
    captured: dict = {}

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(request, timeout=None):
        captured["url"] = request.full_url
        captured["body"] = request.data
        captured["timeout"] = timeout
        return _Response()

    monkeypatch.setattr(error_monitor.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setenv("ERROR_REPORT_ENDPOINT", "http://backend.test/api/client-errors")

    error_monitor.forward({"kind": "ml", "message": "x", "stack": "s", "route": "/predict", "app_version": "dev"})

    assert captured["url"] == "http://backend.test/api/client-errors"
    assert captured["timeout"] == 1.0
    body = json.loads(captured["body"])
    assert body == {"kind": "ml", "message": "x", "stack": "s", "route": "/predict", "app_version": "dev"}


def test_long_tracebacks_keep_the_exception_identity():
    # CI runner paths make traces long; head-clipping must never lose the
    # exception line (the regression that failed only on GitHub's runners).
    def deep(n: int) -> None:
        if n:
            deep(n - 1)
        raise ValueError("deep failure")

    try:
        deep(300)
    except ValueError as exc:
        payload = error_monitor.build_payload(exc, "/predict", 1.0)

    assert payload["message"].startswith("ValueError: deep failure")
    assert "ValueError: deep failure" in payload["stack"]
    assert len(payload["stack"]) <= error_monitor.MAX_STACK


def test_forward_is_silent_without_an_endpoint(monkeypatch):
    monkeypatch.delenv("ERROR_REPORT_ENDPOINT", raising=False)

    # Must neither raise nor attempt a connection.
    error_monitor.forward({"kind": "ml", "message": "x"})


def test_main_app_has_the_monitor_registered_before_cors():
    from api.main import app as main_app

    monitors = [m for m in main_app.user_middleware if m.cls is error_monitor.BaseHTTPMiddleware]
    assert len(monitors) == 1
    assert monitors[0].kwargs.get("dispatch") is error_monitor.dispatch
