<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\GoogleAuthNonceService;
use App\Services\GoogleIdentityTokenVerifier;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use RuntimeException;

class AuthController extends Controller
{
    /** Issue a short-lived nonce for a Google Identity Services sign-in attempt. */
    public function googleNonce(
        GoogleAuthNonceService $nonces,
        GoogleIdentityTokenVerifier $verifier,
    ): JsonResponse {
        if (! $verifier->isConfigured()) {
            return response()->json([
                'message' => 'Google sign-in is not configured for this deployment.',
            ], 503);
        }

        return response()->json(['nonce' => $nonces->issue()]);
    }

    /** Verify Google's signed ID token, create/link the account, and issue a Sanctum token. */
    public function googleSignIn(
        Request $request,
        GoogleIdentityTokenVerifier $verifier,
        GoogleAuthNonceService $nonces,
    ): JsonResponse {
        $input = $request->validate([
            'credential' => ['required', 'string', 'max:8192'],
            'password' => ['prohibited'],
        ]);

        try {
            $identity = $verifier->verify($input['credential']);
        } catch (RuntimeException $exception) {
            Log::warning('Google identity verification is unavailable', [
                'exception' => get_class($exception),
            ]);

            return response()->json([
                'message' => 'Google sign-in is temporarily unavailable. Please try again later.',
            ], 503);
        }

        // A valid ID token is still unusable unless it carries a fresh nonce
        // issued by this API. The nonce is consumed once to block replays.
        $nonces->consume($identity['nonce']);

        try {
            $result = DB::transaction(function () use ($identity): array {
                $googleUser = User::query()
                    ->where('google_sub', $identity['sub'])
                    ->lockForUpdate()
                    ->first();
                $emailOwners = User::query()
                    ->whereRaw('lower(email) = ?', [$identity['email']])
                    ->lockForUpdate()
                    ->get();

                if ($emailOwners->count() > 1) {
                    $this->googleAccountConflict();
                }

                /** @var User|null $emailUser */
                $emailUser = $emailOwners->first();
                if ($googleUser && $emailUser && $googleUser->isNot($emailUser)) {
                    $this->googleAccountConflict();
                }

                $user = $googleUser ?? $emailUser;
                if ($user?->isSuspended()) {
                    return ['suspended' => true];
                }

                if ($user) {
                    if ($user->google_sub !== null
                        && ! hash_equals((string) $user->google_sub, $identity['sub'])) {
                        $this->googleAccountConflict();
                    }

                    // A verified Google email can safely link a legacy TRANA
                    // account. Keep user-edited names intact; refresh the
                    // canonical verified email and record Google's stable sub.
                    $user->google_sub = $identity['sub'];
                    $user->email = $identity['email'];
                    $user->email_verified_at ??= now();
                    if (trim((string) $user->name) === '') {
                        $user->name = $identity['name'];
                    }
                    $user->save();
                } else {
                    $user = User::create([
                        'name' => $identity['name'],
                        'email' => $identity['email'],
                        'google_sub' => $identity['sub'],
                        'password' => null,
                    ]);
                    $user->forceFill(['email_verified_at' => now()])->save();
                }

                $user->ensureProfile();
                $user->ensureGoals();

                return [
                    'token' => $user->createToken('google-pwa')->plainTextToken,
                    'user' => $user,
                ];
            });
        } catch (QueryException $exception) {
            // The unique email / Google-sub indexes arbitrate concurrent first
            // sign-ins. A loser can safely retry with a newly issued nonce.
            if (in_array((string) $exception->getCode(), ['23000', '23505', '19'], true)) {
                return response()->json([
                    'message' => 'This Google account could not be linked. Please try again.',
                ], 409);
            }

            throw $exception;
        }

        if ($result['suspended'] ?? false) {
            return response()->json(['message' => 'This account has been suspended.'], 403);
        }

        return response()->json([
            'token' => $result['token'],
            'user' => $this->userPayload($result['user']),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->json(['message' => 'Signed out.']);
    }

    private function googleAccountConflict(): never
    {
        throw ValidationException::withMessages([
            'credential' => ['This Google account could not be linked to the TRANA account. Please contact support.'],
        ]);
    }

    private function userPayload(User $user): array
    {
        $profile = $user->fitnessProfile;

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'email_verified_at' => $user->email_verified_at?->toIso8601String(),
            'profile' => $profile,
            'created_at' => $user->created_at?->toIso8601String(),
        ];
    }
}
