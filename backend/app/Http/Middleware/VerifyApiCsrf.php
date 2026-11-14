<?php

namespace App\Http\Middleware;

use App\Services\AuthCookieService;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Verify browser origins and double-submit tokens for cookie-authenticated writes. */
class VerifyApiCsrf
{
    private const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

    public function handle(Request $request, Closure $next): Response
    {
        if (in_array(strtoupper($request->method()), self::SAFE_METHODS, true)) {
            return $next($request);
        }

        $cookies = app(AuthCookieService::class);
        $originHeader = $request->headers->get('Origin');
        $hasOriginHeader = is_string($originHeader) && trim($originHeader) !== '';
        $origin = $this->requestOrigin($request);
        $trustedOrigin = $origin !== null && $this->isAllowedOrigin($origin);
        $hasAuthCookie = $request->cookies->has($cookies->authCookieName());
        $hasCsrfCookie = $request->cookies->has($cookies->csrfCookieName());

        // Browser requests include Origin. Reject malformed/opaque origins too,
        // even before login, to prevent login-CSRF and cross-origin OTP posts.
        if ($hasOriginHeader && ! $trustedOrigin) {
            return new JsonResponse(['message' => 'Request origin is not allowed.'], 403);
        }

        // An absent Origin is acceptable for non-browser bearer clients only.
        // Any request carrying our cookies must prove its trusted browser origin.
        if (($hasAuthCookie || $hasCsrfCookie) && ! $trustedOrigin) {
            return new JsonResponse(['message' => 'A trusted origin is required for cookie authentication.'], 403);
        }

        if ($hasAuthCookie || $hasCsrfCookie) {
            $cookieToken = $request->cookie($cookies->csrfCookieName());
            $headerToken = $request->header('X-CSRF-TOKEN');
            if (! is_string($cookieToken) || ! is_string($headerToken)
                || preg_match('/^[a-f0-9]{64}$/', $cookieToken) !== 1
                || ! hash_equals($cookieToken, $headerToken)) {
                return new JsonResponse(['message' => 'The security token is missing or expired. Refresh and try again.'], 419);
            }
        }

        return $next($request);
    }

    private function requestOrigin(Request $request): ?string
    {
        $origin = $request->headers->get('Origin');
        if (is_string($origin) && trim($origin) !== '') {
            return $this->normalizeOrigin($origin);
        }

        $referer = $request->headers->get('Referer');
        if (! is_string($referer) || $referer === '') {
            return null;
        }

        $parts = parse_url($referer);
        if (! is_array($parts) || ! isset($parts['scheme'], $parts['host'])) {
            return null;
        }

        $origin = strtolower($parts['scheme']).'://'.strtolower($parts['host']);
        if (isset($parts['port'])) {
            $origin .= ':'.$parts['port'];
        }

        return $origin;
    }

    private function normalizeOrigin(string $origin): ?string
    {
        $origin = trim($origin);
        if ($origin === 'null') {
            return null;
        }

        $parts = parse_url($origin);
        if (! is_array($parts) || ! isset($parts['scheme'], $parts['host'])
            || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['path']) && $parts['path'] !== ''
            || isset($parts['query']) || isset($parts['fragment'])) {
            return null;
        }

        $normalized = strtolower($parts['scheme']).'://'.strtolower($parts['host']);
        if (isset($parts['port'])) {
            $normalized .= ':'.$parts['port'];
        }

        return $normalized;
    }

    private function isAllowedOrigin(string $origin): bool
    {
        $allowed = config('cors.allowed_origins', []);
        if (! is_array($allowed)) {
            return false;
        }

        foreach ($allowed as $candidate) {
            if (is_string($candidate) && $this->normalizeOrigin($candidate) === $origin) {
                return true;
            }
        }

        return false;
    }
}
