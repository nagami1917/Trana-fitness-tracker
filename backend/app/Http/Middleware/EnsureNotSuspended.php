<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Suspended accounts lose everything: attached after auth:sanctum on the
 * whole authenticated group, so a revoked-then-stolen token still dies here.
 * The current access token is deleted on the way out — the very next
 * request answers 401 and the SPA drops the session automatically.
 */
class EnsureNotSuspended
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $user->isSuspended()) {
            try {
                $request->user()->currentAccessToken()?->delete();
            } catch (\Throwable) {
                // Token already gone — the 403 below still stands.
            }

            return response()->json(['message' => 'This account has been suspended.'], 403);
        }

        return $next($request);
    }
}
