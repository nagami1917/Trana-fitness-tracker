<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Make every /api request behave like a JSON client.
 *
 * This API has no `login` route. When an unauthenticated request reaches
 * `auth:sanctum` without asking for JSON, Laravel's authenticate middleware
 * redirects to `route('login')`, which throws "Route [login] not defined" and
 * surfaces as a 500 instead of the 401 the SPA needs to show the signed-out
 * state. A browser opened directly on an /api URL (or any client that sends
 * `Accept: text/html`) hits exactly that path.
 *
 * Runs before the auth middleware, so `$request->expectsJson()` is already true
 * by the time it decides whether to redirect or to throw a JSON-shaped
 * AuthenticationException.
 */
class TreatApiRequestsAsJson
{
    public function handle(Request $request, Closure $next): Response
    {
        // Never override a client that already negotiates JSON; only rescue the
        // HTML-shaped requests that would otherwise be redirected.
        if (! $request->accepts('application/json')) {
            $request->headers->set('Accept', 'application/json');
        }

        return $next($request);
    }
}
