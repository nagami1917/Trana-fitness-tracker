<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Server-side role gate for the admin console. Applied to every /api/admin
 * route — the frontend's role-based navigation is cosmetic only; this is
 * the enforcement point (Tier 1 rule: no endpoint may trust the client).
 */
class EnsureAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || ! $user->isAdmin()) {
            return response()->json(['message' => 'Admin access required.'], 403);
        }

        return $next($request);
    }
}
