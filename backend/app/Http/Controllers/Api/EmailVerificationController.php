<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Notifications\VerifyEmailNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class EmailVerificationController extends Controller
{
    /**
     * Resend the verification link for the signed-in athlete. Mail failures
     * surface as a clear 503 (SMTP not configured yet) instead of a silent
     * success the user would never notice.
     */
    public function resend(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->hasVerifiedEmail()) {
            return response()->json(['message' => 'Your email is already verified.']);
        }

        try {
            $user->notify(new VerifyEmailNotification());
        } catch (\Throwable $exception) {
            Log::warning('verification email failed', [
                'user_id' => $user->id,
                'error' => $exception->getMessage(),
            ]);

            return response()->json([
                'message' => 'The verification email could not be sent. Mail delivery is not configured on the server yet (MAIL_* settings) — contact support to finish setup.',
            ], 503);
        }

        return response()->json([
            'message' => 'Verification link sent — check your inbox.',
        ], 202);
    }

    /**
     * The signed link target (GET /email/verify/{id}/{hash}). Validates the
     * HMAC signature + expiry, marks the address verified, then redirects to
     * the SPA's /verify-email page. Never renders HTML itself.
     */
    public function verify(Request $request, string $id, string $hash): RedirectResponse
    {
        $frontend = config('frontend.url');

        if (! $request->hasValidSignature()) {
            return redirect()->to($frontend.'/verify-email?status=invalid');
        }

        $user = User::find($id);

        if (! $user || ! hash_equals(sha1($user->getEmailForVerification()), $hash)) {
            return redirect()->to($frontend.'/verify-email?status=invalid');
        }

        if (! $user->hasVerifiedEmail()) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        return redirect()->to($frontend.'/verify-email?status=verified');
    }
}
