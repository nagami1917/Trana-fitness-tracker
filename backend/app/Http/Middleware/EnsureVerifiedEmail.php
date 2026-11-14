<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Only a Google-verified email may use the authenticated API surface. */
class EnsureVerifiedEmail
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && ! $user->email_verified_at) {
            try {
                // Legacy tokens must not bypass the Google email-verification gate.
                $user->currentAccessToken()?->delete();
            } catch (\Throwable) {
                // The response still rejects an unverified account if its token is gone.
            }

            return response()->json([
                'message' => 'Use Google sign-in to verify your email before continuing.',
            ], 401);
        }

        return $next($request);
    }
}
