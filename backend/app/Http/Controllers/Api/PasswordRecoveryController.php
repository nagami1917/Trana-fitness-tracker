<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Validation\ValidationException;

class PasswordRecoveryController extends Controller
{
    /**
     * Step 1 — ask for a reset link. Always answers the same generic 202 so
     * the endpoint cannot be used to probe which emails are registered.
     */
    public function forgot(Request $request): JsonResponse
    {
        $request->validate([
            'email' => ['required', 'email'],
        ]);

        // Stored emails are lowercase (registration normalizes) — match that.
        $request->merge(['email' => strtolower(trim((string) $request->input('email')))]);

        // Broker failures (unknown email, throttled) are intentionally ignored.
        Password::broker()->sendResetLink($request->only('email'));

        return response()->json([
            'message' => 'If that email has a TRANA account, a reset link is on its way.',
        ], 202);
    }

    /**
     * Step 2 — consume the emailed token and set the new password. On success
     * every existing token for the account is revoked (sign out everywhere).
     */
    public function reset(Request $request): JsonResponse
    {
        $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        // Same canonical-lowercase rule as registration and login.
        $request->merge(['email' => strtolower(trim((string) $request->input('email')))]);

        $status = Password::broker()->reset(
            $request->only('token', 'email', 'password', 'password_confirmation'),
            function (User $user, string $password): void {
                $user->forceFill(['password' => Hash::make($password)])->save();
                $user->tokens()->delete();
            }
        );

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages([
                'email' => [__($status)],
            ]);
        }

        return response()->json([
            'message' => 'Password updated — you can sign in now.',
        ]);
    }
}
