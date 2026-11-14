<?php

namespace App\Http\Middleware;

use App\Services\AuthCookieService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Expose the HttpOnly Sanctum token only to the server-side auth guard. */
class AuthenticateFromHttpOnlyCookie
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->bearerToken() === null) {
            $token = $request->cookie(app(AuthCookieService::class)->authCookieName());
            if (is_string($token) && strlen($token) <= 256 && preg_match('/^[0-9]+\|[A-Za-z0-9]+$/', $token) === 1) {
                $request->headers->set('Authorization', 'Bearer '.$token);
            }
        }

        return $next($request);
    }
}
