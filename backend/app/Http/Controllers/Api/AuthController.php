<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\RegisterRequest;
use App\Models\User;
use App\Notifications\VerifyEmailNotification;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(RegisterRequest $request): JsonResponse
    {
        $data = $request->validated();

        return DB::transaction(function () use ($data) {
            $user = User::create($data);
            $user->ensureProfile();
            $user->ensureGoals();

            // Verification email is best-effort: a mail outage must never fail
            // registration (the user can hit "Resend" from the verify screen).
            try {
                $user->notify(new VerifyEmailNotification());
            } catch (\Throwable $exception) {
                Log::warning('verification email failed on register', [
                    'user_id' => $user->id,
                    'error' => $exception->getMessage(),
                ]);
            }

            return response()->json([
                'token' => $user->createToken('pwa')->plainTextToken,
                'user' => $this->userPayload($user),
            ], 201);
        });
    }

    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['nullable', 'string', 'max:60'],
        ]);

        // Registration lowercases emails — match case-insensitively too.
        $user = User::where('email', strtolower($credentials['email']))->first();

        if (! $user || ! Hash::check($credentials['password'], $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
        }

        // Suspended accounts cannot sign in at all — the flag is enforced
        // again on every authenticated request (EnsureNotSuspended).
        if ($user->isSuspended()) {
            return response()->json(['message' => 'This account has been suspended.'], 403);
        }

        $user->ensureProfile();
        $user->ensureGoals();

        return response()->json([
            'token' => $user->createToken($credentials['device_name'] ?? 'pwa')->plainTextToken,
            'user' => $this->userPayload($user),
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
