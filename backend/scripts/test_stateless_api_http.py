#!/usr/bin/env python3
"""Exercise HttpOnly-cookie API auth and CSRF checks through a real HTTP server.

Laravel normally bypasses CSRF checks while PHPUnit runs. Run a local server in
a temporary copy to test the browser boundary with an isolated SQLite database.
This script never reads the checkout's .env or cached configuration.
"""

from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://localhost:5173"


def request(port: int, method: str, path: str, *, body=None, token=None, cookie=None, csrf=None, origin=ORIGIN):
    headers = {
        "Accept": "application/json",
        "Origin": origin,
        "Referer": origin + "/register",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body)
    if token:
        headers["Authorization"] = "Bearer " + token
    if cookie:
        headers["Cookie"] = cookie
    if csrf:
        headers["X-CSRF-TOKEN"] = csrf
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        data = response.read()
        headers = response.getheaders()
        return response.status, json.loads(data) if data else None, headers
    finally:
        conn.close()


def expect_status(result, expected, description):
    status, data, _ = result
    if status != expected:
        message = data.get("message", "") if isinstance(data, dict) else ""
        raise AssertionError(f"{description}: expected HTTP {expected}, got {status}: {message}")
    return data


def run_checked(command, *, cwd, env, text=False):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=text)
    if result.returncode != 0:
        stdout = result.stdout if isinstance(result.stdout, str) else result.stdout.decode(errors="replace")
        stderr = result.stderr if isinstance(result.stderr, str) else result.stderr.decode(errors="replace")
        output = "\n".join(part.strip() for part in (stdout, stderr) if part and part.strip())
        raise RuntimeError(
            f"Command {' '.join(map(str, command))} failed with exit {result.returncode}.\n{output}"
        )
    return result


def main():
    php = shutil.which("php")
    if php is None:
        raise SystemExit("PHP is required for the real HTTP smoke test.")
    if not (ROOT / "vendor/autoload.php").is_file():
        raise SystemExit("Install backend Composer dependencies before running this test.")

    with tempfile.TemporaryDirectory(prefix="trana-cookie-api-") as temp:
        app = Path(temp) / "app"
        app.mkdir()
        for folder in ("app", "bootstrap", "config", "database", "public", "routes", "vendor"):
            if folder == "bootstrap":
                shutil.copytree(ROOT / folder, app / folder, ignore=shutil.ignore_patterns("cache"))
                (app / "bootstrap/cache").mkdir()
            elif folder == "database":
                shutil.copytree(ROOT / folder, app / folder, ignore=shutil.ignore_patterns("*.sqlite*", "*.db*"))
            else:
                shutil.copytree(ROOT / folder, app / folder)
        for filename in ("artisan", "composer.json"):
            shutil.copy2(ROOT / filename, app / filename)
        for folder in ("storage/framework/cache/data", "storage/framework/sessions", "storage/framework/views", "storage/logs"):
            (app / folder).mkdir(parents=True)

        database = Path(temp) / "test.sqlite"
        database.touch()
        system_keys = ("PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TMP", "TEMP", "LANG", "LC_ALL", "PHPRC", "PHP_INI_SCAN_DIR", "LD_LIBRARY_PATH")
        env = {key: os.environ[key] for key in system_keys if key in os.environ}
        env.update({
            "APP_ENV": "local",
            "APP_KEY": "base64:MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
            "APP_DEBUG": "false",
            "APP_URL": "http://127.0.0.1",
            "FRONTEND_URL": ORIGIN,
            "CORS_ALLOWED_ORIGINS": ORIGIN,
            "DB_CONNECTION": "sqlite",
            "DB_DATABASE": str(database),
            "CACHE_STORE": "array",
            "SESSION_DRIVER": "array",
            "QUEUE_CONNECTION": "sync",
            "MAIL_MAILER": "array",
            "BCRYPT_ROUNDS": "4",
            "SANCTUM_STATEFUL_DOMAINS": "localhost:5173,127.0.0.1:5173",
        })
        run_checked([php, "artisan", "migrate", "--force", "--no-interaction"], cwd=app, env=env)
        run_checked([php, "artisan", "config:cache"], cwd=app, env=env)
        guard_check = r'''
            require "vendor/autoload.php";
            $app = require "bootstrap/app.php";
            $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
            if (config("sanctum.guard") !== []) {
                fwrite(STDERR, "Sanctum must reject web-session authentication.\n");
                exit(1);
            }
        '''
        run_checked([php, "-r", guard_check], cwd=app, env=env, text=True)

        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        router = app / "vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php"
        with tempfile.TemporaryFile(mode="w+") as logs:
            server = subprocess.Popen([php, "-S", f"127.0.0.1:{port}", str(router)], cwd=app / "public", env=env, stdout=logs, stderr=logs)
            try:
                deadline = time.monotonic() + 15
                while True:
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                            break
                    except OSError:
                        if server.poll() is not None or time.monotonic() > deadline:
                            logs.seek(0)
                            raise RuntimeError("Test server failed to start: " + logs.read())
                        time.sleep(0.1)

                expect_status(request(port, "GET", "/api/health"), 200, "database health")
                csrf_response = request(port, "GET", "/api/auth/csrf")
                csrf_data = expect_status(csrf_response, 200, "CSRF bootstrap")
                csrf = csrf_data.get("csrfToken")
                assert isinstance(csrf, str) and len(csrf) == 64, "CSRF bootstrap must return a random token."
                csrf_cookie = f"trana_csrf={csrf}"

                expect_status(request(port, "POST", "/api/auth/register", body={}, cookie=csrf_cookie), 419, "missing CSRF header")
                expect_status(request(port, "POST", "/api/auth/register", body={}, cookie=csrf_cookie, csrf=csrf, origin="https://evil.example"), 403, "untrusted browser Origin")
                expect_status(request(port, "POST", "/api/auth/register", body={}, cookie=csrf_cookie, csrf=csrf), 422, "trusted request reaches registration validation")

                create_token = r'''
                    require "vendor/autoload.php";
                    $app = require "bootstrap/app.php";
                    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
                    $user = App\Models\User::create([
                        "name" => "Cookie HTTP Test",
                        "username" => "cookie_http_test",
                        "email" => "cookie-http@gmail.com",
                        "password" => Illuminate\Support\Facades\Hash::driver("bcrypt")->make("Http-test-123"),
                    ]);
                    $user->forceFill(["email_verified_at" => now()])->save();
                    $user->ensureProfile();
                    $user->ensureGoals();
                    echo $user->createToken("http-test")->plainTextToken;
                '''
                token = run_checked([php, "-r", create_token], cwd=app, env=env, text=True).stdout.strip()
                assert re.fullmatch(r"[0-9]+\|[A-Za-z0-9]+", token), "Could not create a valid-format test Sanctum token."
                auth_cookie = f"trana_session={token}; {csrf_cookie}"

                expect_status(request(port, "GET", "/api/profile", cookie="laravel_session=stale"), 401, "web-session-only profile")
                # Capture the cookie result before a bearer request can mask a
                # broken cookie-to-Authorization middleware path.
                cookie_profile = request(port, "GET", "/api/profile", cookie=auth_cookie)
                bearer_profile = request(port, "GET", "/api/profile", token=token)
                if cookie_profile[0] != 200:
                    cookie_message = cookie_profile[1].get("message", "") if isinstance(cookie_profile[1], dict) else ""
                    bearer_message = bearer_profile[1].get("message", "") if isinstance(bearer_profile[1], dict) else ""
                    raise AssertionError(
                        f"HttpOnly-cookie profile: got HTTP {cookie_profile[0]}: {cookie_message}; "
                        f"direct bearer profile: got HTTP {bearer_profile[0]}: {bearer_message}"
                    )
                expect_status(bearer_profile, 200, "non-browser bearer profile")
                expect_status(request(port, "PUT", "/api/profile", cookie=auth_cookie, body={"weight_kg": 68}), 419, "cookie write missing CSRF header")
                expect_status(request(port, "PUT", "/api/profile", cookie=auth_cookie, csrf=csrf, body={"weight_kg": 68}), 200, "cookie write with CSRF")
                expect_status(request(port, "PUT", "/api/profile", cookie=auth_cookie, csrf=csrf, body={"weight_kg": 69}, origin="https://evil.example"), 403, "cookie write from untrusted Origin")
                expect_status(request(port, "POST", "/api/activities", cookie=auth_cookie, csrf=csrf, body={
                    "activity_type": "run", "distance_km": 5, "duration_min": 30, "started_at": "2026-01-01T08:00:00Z",
                }), 201, "cookie-authenticated activity creation")
                expect_status(request(port, "POST", "/api/auth/logout", cookie=auth_cookie, csrf=csrf, body={}), 200, "cookie logout")
                expect_status(request(port, "GET", "/api/profile", cookie=auth_cookie), 401, "revoked cookie token")

                invalid_login = request(port, "POST", "/api/auth/login", body={
                    "identifier": "missing@gmail.com", "password": "Http-test-123",
                }, cookie=csrf_cookie, csrf=csrf)
                login_data = expect_status(invalid_login, 401, "generic invalid credentials")
                assert login_data.get("message") == "Invalid credentials.", "Login errors must be generic."
                expect_status(request(port, "POST", "/api/auth/google", body={}), 404, "removed Google-only endpoint")
                print("HttpOnly-cookie auth, CSRF/origin protection, and stateless API smoke test passed.")
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    main()
