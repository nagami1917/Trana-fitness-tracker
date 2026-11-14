<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Only an OTP-confirmed email may use the authenticated API surface. */
class EnsureVerifiedEmail
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && ! $user->email_verified_at) {
            try {
                // Old pre-OTP tokens must not bypass the new code-confirmation gate.
                $user->currentAccessToken()?->delete();
            } catch (\Throwable) {
                // The response still rejects an unverified account if its token is gone.
            }

            return response()->json([
                'message' => 'Confirm your email with a sign-in code before continuing.',
            ], 401);
        }

        return $next($request);
    }
}
