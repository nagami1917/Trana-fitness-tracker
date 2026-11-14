<?php

namespace App\Services;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;

/** Secure, HttpOnly cookies for the API token and double-submit CSRF token. */
class AuthCookieService
{
    public function authCookie(string $token): Cookie
    {
        return cookie(
            $this->authCookieName(),
            $token,
            $this->lifetimeMinutes(),
            '/api',
            $this->domain(),
            $this->secure(),
            true,
            false,
            $this->sameSite(),
        );
    }

    public function csrfCookie(string $token): Cookie
    {
        return cookie(
            $this->csrfCookieName(),
            $token,
            $this->lifetimeMinutes(),
            '/api',
            $this->domain(),
            $this->secure(),
            true,
            false,
            $this->sameSite(),
        );
    }

    /** @return array{0: Cookie, 1: Cookie} */
    public function forgetCookies(): array
    {
        return [
            cookie($this->authCookieName(), '', -262800, '/api', $this->domain(), $this->secure(), true, false, $this->sameSite()),
            cookie($this->csrfCookieName(), '', -262800, '/api', $this->domain(), $this->secure(), true, false, $this->sameSite()),
        ];
    }

    public function authCookieName(): string
    {
        return (string) config('services.trana.auth_cookie', 'trana_session');
    }

    public function csrfCookieName(): string
    {
        return (string) config('services.trana.csrf_cookie', 'trana_csrf');
    }

    public function csrfToken(Request $request): string
    {
        $existing = $request->cookie($this->csrfCookieName());
        if (is_string($existing) && preg_match('/^[a-f0-9]{64}$/', $existing) === 1) {
            return $existing;
        }

        return bin2hex(random_bytes(32));
    }

    public function newCsrfToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    public function lifetimeMinutes(): int
    {
        return max(5, (int) config('services.trana.auth_cookie_minutes', 720));
    }

    private function domain(): ?string
    {
        $domain = config('services.trana.cookie_domain');

        return is_string($domain) && trim($domain) !== '' ? trim($domain) : null;
    }

    private function secure(): bool
    {
        return app()->environment('production') || request()->isSecure();
    }

    private function sameSite(): string
    {
        $sameSite = strtolower((string) config('services.trana.cookie_same_site', 'lax'));

        return in_array($sameSite, ['lax', 'strict', 'none'], true) ? $sameSite : 'lax';
    }
}
