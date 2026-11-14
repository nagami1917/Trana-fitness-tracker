#!/usr/bin/env python3
"""Exercise browser-origin bearer requests with CSRF checks enabled.

Laravel normally disables CSRF checks while PHPUnit runs. Run a real local
server in a temporary copy instead, so a stateful-middleware regression cannot
be hidden by the test environment. The temporary app uses an isolated SQLite
database and never reads this checkout's .env or cached configuration.
"""

from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://localhost:5173"


def request(port: int, method: str, path: str, *, body=None, token=None, cookie=None):
    headers = {
        "Accept": "application/json",
        "Origin": ORIGIN,
        "Referer": ORIGIN + "/register",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body)
    if token:
        headers["Authorization"] = "Bearer " + token
    if cookie:
        headers["Cookie"] = cookie
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


def main():
    php = shutil.which("php")
    if php is None:
        raise SystemExit("PHP is required for the real HTTP smoke test.")
    if not (ROOT / "vendor/autoload.php").is_file():
        raise SystemExit("Install backend Composer dependencies before running this test.")

    with tempfile.TemporaryDirectory(prefix="trana-stateless-api-") as temp:
        app = Path(temp) / "app"
        app.mkdir()
        # Do not copy .env, storage, or cached config from the developer's app.
        for folder in ("app", "bootstrap", "config", "database", "public", "routes", "vendor"):
            if folder == "bootstrap":
                # Keep bootstrap/app.php and providers.php, but not generated cache files.
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
        # Keep only system variables needed to run PHP. No caller database,
        # application, or ML secrets are inherited into the temporary app.
        system_keys = ("PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TMP", "TEMP", "LANG", "LC_ALL", "PHPRC", "PHP_INI_SCAN_DIR", "LD_LIBRARY_PATH")
        env = {key: os.environ[key] for key in system_keys if key in os.environ}
        env.update({
            "APP_ENV": "local",  # CSRF middleware must not use the PHPUnit bypass.
            "APP_KEY": "base64:MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
            "APP_DEBUG": "false",
            "DB_CONNECTION": "sqlite",
            "DB_DATABASE": str(database),
            "CACHE_STORE": "array",
            "SESSION_DRIVER": "array",
            "QUEUE_CONNECTION": "sync",
            "MAIL_MAILER": "array",
            "BCRYPT_ROUNDS": "4",
            "SANCTUM_STATEFUL_DOMAINS": "localhost:5173,127.0.0.1:5173",
        })
        subprocess.run([php, "artisan", "migrate", "--force", "--no-interaction"], cwd=app, env=env, check=True, capture_output=True)
        # Production deployments commonly cache config. Verify that the
        # token-only Sanctum guard survives the package-default merge.
        subprocess.run([php, "artisan", "config:cache"], cwd=app, env=env, check=True, capture_output=True)
        guard_check = r'''
            require "vendor/autoload.php";
            $app = require "bootstrap/app.php";
            $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
            if (config("sanctum.guard") !== []) {
                fwrite(STDERR, "Cached Sanctum config must reject web-session authentication.\n");
                exit(1);
            }
        '''
        subprocess.run([php, "-r", guard_check], cwd=app, env=env, check=True, capture_output=True)

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
                registration = request(port, "POST", "/api/auth/register", body={
                    "name": "Browser Origin Test", "email": "browser@gmail.com",
                }, cookie="laravel_session=stale; XSRF-TOKEN=stale")
                data = expect_status(registration, 202, "browser-origin OTP registration without CSRF token")
                assert "token" not in data, "A bearer token must not be issued before OTP verification."
                assert not any(name.lower() == "set-cookie" for name, _ in registration[2]), "API must not issue session cookies."

                # This HTTP smoke focuses on browser-origin and bearer-only API
                # behavior; the PHP feature tests exercise the OTP verification
                # email boundary and token issuance.
                create_token = r'''
                    require "vendor/autoload.php";
                    $app = require "bootstrap/app.php";
                    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
                    $user = App\Models\User::create([
                        "name" => "Bearer HTTP Test",
                        "email" => "bearer-http@gmail.com",
                        "password" => null,
                    ]);
                    $user->forceFill(["email_verified_at" => now()])->save();
                    echo $user->createToken("http-test")->plainTextToken;
                '''
                token = subprocess.run([php, "-r", create_token], cwd=app, env=env, check=True, capture_output=True, text=True).stdout.strip()
                assert token, "Could not create the test bearer token."

                expect_status(request(port, "GET", "/api/profile", cookie="laravel_session=stale"), 401, "cookie-only profile")
                expect_status(request(port, "GET", "/api/profile", token=token), 200, "bearer profile")
                expect_status(request(port, "PUT", "/api/profile", token=token, body={"weight_kg": 68}), 200, "bearer profile update")
                expect_status(request(port, "POST", "/api/activities", token=token, body={
                    "activity_type": "run", "distance_km": 5, "duration_min": 30, "started_at": "2026-01-01T08:00:00Z",
                }), 201, "bearer activity creation")
                expect_status(request(port, "POST", "/api/auth/logout", token=token), 200, "bearer logout")
                expect_status(request(port, "GET", "/api/profile", token=token), 401, "revoked bearer token")
                login = request(port, "POST", "/api/auth/login", body={
                    "email": "bearer-http@gmail.com",
                })
                login_data = expect_status(login, 202, "browser-origin OTP request without CSRF token")
                assert "token" not in login_data, "Login must not issue a token before OTP verification."
                print("Browser-origin bearer API smoke test passed.")
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    main()
