<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Only an email-verified user may use the authenticated API surface. */
class EnsureVerifiedEmail
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && ! $user->email_verified_at) {
            try {
                // Existing tokens must not bypass the email verification gate.
                $user->currentAccessToken()?->delete();
            } catch (\Throwable) {
                // The response still rejects an unverified account if its token is gone.
            }

            return response()->json([
                'message' => 'Verify your email address with the code sent to your inbox before continuing.',
            ], 401);
        }

        return $next($request);
    }
}
