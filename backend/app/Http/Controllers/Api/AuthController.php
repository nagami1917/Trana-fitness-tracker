<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\RegisterRequest;
use App\Models\User;
use App\Services\EmailOtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

class AuthController extends Controller
{
    /** Start account creation; the account is persisted only after code entry. */
    public function register(RegisterRequest $request, EmailOtpService $otp): JsonResponse
    {
        $data = $request->validated();
        $email = strtolower(trim($data['email']));

        try {
            $sent = $otp->issue($email, trim($data['name']), EmailOtpService::PURPOSE_REGISTRATION);
        } catch (Throwable $exception) {
            return $this->emailDeliveryFailed($email, $exception);
        }

        if (! $sent) {
            return response()->json([
                'message' => 'Please wait a minute before requesting another code. Check your inbox and spam folder first.',
            ], 429);
        }

        return response()->json([
            'message' => 'A six-digit code was sent to your email. It expires in 10 minutes.',
        ], 202);
    }

    /** Request a sign-in code; passwords are not used by TRANA. */
    public function login(Request $request, EmailOtpService $otp): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'password' => ['prohibited'],
        ]);
        $email = strtolower(trim($credentials['email']));
        $generic = [
            'message' => 'If that email has a TRANA account, a six-digit sign-in code is on its way.',
        ];

        $user = User::query()->where('email', $email)->first();
        if (! $user) {
            // Same response for unknown addresses prevents account enumeration.
            return response()->json($generic, 202);
        }
        if ($user->isSuspended()) {
            return response()->json(['message' => 'This account has been suspended.'], 403);
        }

        try {
            // A suppressed resend still receives the same response. The UI
            // enforces the cooldown; the server remains the source of truth.
            $otp->issue($email, $user->name, EmailOtpService::PURPOSE_LOGIN);
        } catch (Throwable $exception) {
            return $this->emailDeliveryFailed($email, $exception);
        }

        return response()->json($generic, 202);
    }

    /** Consume a one-time code and issue a Sanctum bearer token. */
    public function verifyOtp(Request $request, EmailOtpService $otp): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'code' => ['required', 'string', 'regex:/^[0-9]{6}$/'],
            'password' => ['prohibited'],
        ]);

        $result = $otp->verify(strtolower(trim($credentials['email'])), $credentials['code']);

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

    private function emailDeliveryFailed(string $email, Throwable $exception): JsonResponse
    {
        Log::warning('Email OTP delivery failed', [
            'email_hash' => hash('sha256', strtolower($email)),
            'exception' => get_class($exception),
        ]);

        return response()->json([
            'message' => 'The email service could not send your code. Please try again later or contact support.',
        ], 503);
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
