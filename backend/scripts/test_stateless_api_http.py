#!/usr/bin/env python3
"""Exercise signup, email verification, cookies and CSRF over real local HTTP.

Laravel normally bypasses CSRF checks while PHPUnit runs. Run a local server in
a temporary copy with isolated SQLite and a loopback-only SMTP capture so a
valid synthetic signup can be verified without delivering mail externally.
This script never reads the checkout's .env or cached configuration.
"""

from __future__ import annotations

from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
import http.client
import json
import os
from pathlib import Path
import queue
import re
import shutil
import socket
import socketserver
import subprocess
import tempfile
import threading
import time


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://localhost:5173"


class CaptureSMTPHandler(socketserver.StreamRequestHandler):
    """Accept one local SMTP transaction and capture it without sending mail."""

    def handle(self):
        self.wfile.write(b"220 localhost TRANA test SMTP\r\n")
        self.wfile.flush()
        message = []
        in_data = False

        while True:
            line = self.rfile.readline()
            if not line:
                return

            if in_data:
                if line in (b".\r\n", b".\n"):
                    self.server.messages.put(b"".join(message))
                    self.wfile.write(b"250 2.0.0 captured locally\r\n")
                    self.wfile.flush()
                    message = []
                    in_data = False
                else:
                    message.append(line[1:] if line.startswith(b"..") else line)
                continue

            command = line.decode("ascii", errors="replace").strip().split(" ", 1)[0].upper()
            if command in {"EHLO", "HELO"}:
                self.wfile.write(b"250-localhost\r\n250 SIZE 52428800\r\n")
            elif command == "MAIL":
                self.wfile.write(b"250 2.1.0 sender accepted\r\n")
            elif command == "RCPT":
                self.wfile.write(b"250 2.1.5 recipient accepted\r\n")
            elif command == "DATA":
                in_data = True
                self.wfile.write(b"354 end with <CRLF>.<CRLF>\r\n")
            elif command in {"RSET", "NOOP"}:
                self.wfile.write(b"250 2.0.0 ok\r\n")
            elif command == "QUIT":
                self.wfile.write(b"221 2.0.0 bye\r\n")
                self.wfile.flush()
                return
            else:
                self.wfile.write(b"502 5.5.1 command not supported\r\n")
            self.wfile.flush()


class CaptureSMTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address):
        self.messages = queue.Queue()
        super().__init__(address, CaptureSMTPHandler)


def captured_otp(server: CaptureSMTPServer, expected_email: str) -> str:
    try:
        raw_message = server.messages.get(timeout=10)
    except queue.Empty as exception:
        raise AssertionError("Registration did not send an email to the local SMTP capture.") from exception

    message = BytesParser(policy=policy.default).parsebytes(raw_message)
    recipients = [address.lower() for _, address in getaddresses(message.get_all("to", []))]
    assert expected_email in recipients, f"OTP email went to an unexpected recipient: {recipients}"

    body = "\n".join(
        part.get_content()
        for part in message.walk()
        if part.get_content_type() == "text/plain" and part.get_content_disposition() != "attachment"
    )
    match = re.search(r"(?<![0-9])([0-9]{6})(?![0-9])", body)
    assert match, "Captured registration email did not contain a six-digit OTP."
    return match.group(1)


def set_cookie_value(headers, name: str) -> tuple[str, str]:
    prefix = name.lower() + "="
    for header_name, value in headers:
        if header_name.lower() == "set-cookie" and value.lower().startswith(prefix):
            return value.split(";", 1)[0], value
    raise AssertionError(f"Response did not set the {name} cookie.")


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
        smtp_server = CaptureSMTPServer(("127.0.0.1", 0))
        smtp_thread = threading.Thread(target=smtp_server.serve_forever, daemon=True)
        smtp_thread.start()
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
            "MAIL_MAILER": "smtp",
            "MAIL_SCHEME": "smtp",
            "MAIL_HOST": "127.0.0.1",
            "MAIL_PORT": str(smtp_server.server_address[1]),
            "MAIL_FROM_ADDRESS": "test@example.com",
            "MAIL_FROM_NAME": "TRANA HTTP test",
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
                csrf_cookie, csrf_cookie_header = set_cookie_value(csrf_response[2], "trana_csrf")
                assert csrf_cookie.partition("=")[2] == csrf, "CSRF bootstrap cookie must match its response token."
                assert "httponly" in csrf_cookie_header.lower() and "path=/api" in csrf_cookie_header.lower(), "CSRF cookie must be HttpOnly and scoped to /api."

                expect_status(request(port, "POST", "/api/auth/register", body={}, cookie=csrf_cookie), 419, "missing CSRF header")
                expect_status(request(port, "POST", "/api/auth/register", body={}, cookie=csrf_cookie, csrf=csrf, origin="https://evil.example"), 403, "untrusted browser Origin")
                expect_status(request(port, "POST", "/api/auth/register", body={}, cookie=csrf_cookie, csrf=csrf), 422, "trusted request reaches registration validation")

                signup_email = "signup-http@gmail.com"
                signup_password = "Http-flow-123"
                signup = {
                    "name": "Signup HTTP Test",
                    "username": "signup_http_test",
                    "email": signup_email,
                    "password": signup_password,
                    "password_confirmation": signup_password,
                }
                register_response = request(
                    port, "POST", "/api/auth/register", body=signup,
                    cookie=csrf_cookie, csrf=csrf,
                )
                register_data = expect_status(register_response, 202, "valid signup over HTTP")
                assert register_data.get("email") == signup_email
                assert register_data.get("expires_in") == 300
                assert "token" not in register_data, "Registration must not sign in an unverified account."

                # This disposable app sends only to the loopback SMTP capture;
                # the six-digit code never leaves this isolated test process.
                code = captured_otp(smtp_server, signup_email)
                pending_login = request(port, "POST", "/api/auth/login", body={
                    "identifier": "signup_http_test", "password": signup_password,
                }, cookie=csrf_cookie, csrf=csrf)
                pending_data = expect_status(pending_login, 403, "unverified account cannot sign in")
                assert pending_data.get("code") == "EMAIL_NOT_VERIFIED"

                verification = request(port, "POST", "/api/auth/email/verify", body={
                    "email": signup_email, "code": code,
                }, cookie=csrf_cookie, csrf=csrf)
                verify_data = expect_status(verification, 200, "email OTP verification over HTTP")
                assert verify_data.get("verified") is True
                login_response = request(port, "POST", "/api/auth/login", body={
                    "identifier": "signup_http_test", "password": signup_password,
                }, cookie=csrf_cookie, csrf=csrf)
                login_data = expect_status(login_response, 200, "verified signup can sign in by username")
                assert login_data.get("user", {}).get("email") == signup_email
                assert login_data.get("user", {}).get("verified") is True
                assert "token" not in login_data, "API auth tokens must not appear in JSON."
                signup_session_cookie, signup_session_header = set_cookie_value(login_response[2], "trana_session")
                signup_csrf_cookie, signup_csrf_header = set_cookie_value(login_response[2], "trana_csrf")
                next_csrf = login_data.get("csrfToken")
                assert isinstance(next_csrf, str) and len(next_csrf) == 64
                assert signup_csrf_cookie.partition("=")[2] == next_csrf
                assert "httponly" in signup_session_header.lower() and "path=/api" in signup_session_header.lower()
                assert "httponly" in signup_csrf_header.lower() and "path=/api" in signup_csrf_header.lower()
                signup_auth_cookie = f"{signup_session_cookie}; {signup_csrf_cookie}"
                me_data = expect_status(request(port, "GET", "/api/auth/me", cookie=signup_auth_cookie), 200, "authenticated signup session")
                assert me_data.get("user", {}).get("username") == "signup_http_test"
                assert me_data.get("user", {}).get("verified") is True
                expect_status(request(port, "GET", "/api/profile", cookie=signup_auth_cookie), 200, "verified signup creates a profile")
                expect_status(request(port, "GET", "/api/goals", cookie=signup_auth_cookie), 200, "verified signup creates goals")

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
                print("HTTP signup, loopback OTP email, verification, HttpOnly-cookie login, and CSRF smoke test passed.")
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
                smtp_server.shutdown()
                smtp_server.server_close()
                smtp_thread.join(timeout=5)


if __name__ == "__main__":
    main()
