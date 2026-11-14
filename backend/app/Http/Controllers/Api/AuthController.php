<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmailOtpChallenge;
use App\Models\User;
use App\Services\AuthCookieService;
use App\Services\EmailOtpService;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Throwable;

class AuthController extends Controller
{
    private static ?string $dummyPasswordHash = null;

    /** Provide a CSRF value to the same-origin frontend and set its HttpOnly cookie. */
    public function csrf(Request $request, AuthCookieService $cookies): JsonResponse
    {
        $token = $cookies->csrfToken($request);

        return response()->json(['csrfToken' => $token])
            ->withCookie($cookies->csrfCookie($token));
    }

    /** Create an unverified Gmail account, then send the first verification code. */
    public function register(Request $request, EmailOtpService $otp): JsonResponse
    {
        $rawUsername = $request->input('username');
        $rawEmail = $request->input('email');
        $request->merge([
            'name' => $this->cleanName($request->input('name')),
            'username' => is_string($rawUsername) ? strtolower(trim($rawUsername)) : $rawUsername,
            'email' => is_string($rawEmail) ? strtolower(trim($rawEmail)) : $rawEmail,
        ]);

        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:80'],
            'username' => ['required', 'string', 'min:3', 'max:20', 'regex:/^[a-zA-Z0-9_]+$/', 'unique:users,username'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'regex:/^[^@\s]+@gmail\.com$/i', 'unique:users,email'],
            'password' => $this->passwordRules(),
        ]);

        try {
            $user = DB::transaction(fn () => User::create([
                'name' => $data['name'],
                'username' => $data['username'],
                'email' => $data['email'],
                'password' => Hash::driver('bcrypt')->make($data['password']),
                'email_verified_at' => null,
            ]));
        } catch (QueryException $exception) {
            if (in_array((string) $exception->getCode(), ['23000', '23505', '19'], true)) {
                throw ValidationException::withMessages([
                    'email' => ['These account details are already in use. Try signing in or use different details.'],
                ]);
            }
            throw $exception;
        }

        try {
            $sent = $otp->issue($user->email, $user->name, EmailOtpService::PURPOSE_REGISTRATION);
        } catch (Throwable $exception) {
            Log::warning('Registration verification email could not be delivered', [
                'email_hash' => hash('sha256', $user->email),
                'exception' => get_class($exception),
            ]);

            return response()->json([
                'code' => 'EMAIL_VERIFICATION_UNAVAILABLE',
                'email' => $user->email,
                'expires_in' => 0,
                'resend_after' => EmailOtpService::SEND_COOLDOWN_SECONDS,
                'message' => 'Your account is saved, but the verification email could not be sent. Please try resending the code.',
            ], 503);
        }

        if (! $sent) {
            return response()->json(['message' => 'Please wait 60 seconds before requesting another code.'], 429);
        }

        return response()->json([
            'message' => 'Enter the six-digit code sent to your Gmail address.',
            'email' => $user->email,
            'expires_in' => EmailOtpService::CODE_TTL_MINUTES * 60,
            'resend_after' => EmailOtpService::SEND_COOLDOWN_SECONDS,
        ], 202);
    }

    /** Verify registration and activate the account. This does not sign the user in. */
    public function verifyEmail(Request $request, EmailOtpService $otp): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'regex:/^[^@\s]+@gmail\.com$/i'],
            'code' => ['required', 'string', 'regex:/^[0-9]{6}$/'],
        ]);
        $email = strtolower(trim($data['email']));

        $user = User::query()->where('email', $email)->first();
        if (! $user || $user->email_verified_at) {
            throw ValidationException::withMessages([
                'code' => ['That code is invalid, expired, or already used. Request a fresh code and try again.'],
            ]);
        }

        // Consume attempts in the OTP transaction before the account write so a
        // failed-code response cannot roll the attempt counter back.
        $otp->verify($email, $data['code'], EmailOtpService::PURPOSE_REGISTRATION);

        DB::transaction(function () use ($email): void {
            $user = User::query()->where('email', $email)->lockForUpdate()->first();
            if (! $user || $user->email_verified_at) {
                throw ValidationException::withMessages([
                    'code' => ['That code is invalid, expired, or already used. Request a fresh code and try again.'],
                ]);
            }

            $user->forceFill(['email_verified_at' => now()])->save();
            $user->ensureProfile();
            $user->ensureGoals();
        });

        return response()->json(['message' => 'Account verified. You can now log in.', 'verified' => true]);
    }

    /** Generic response avoids revealing whether an address has an unverified account. */
    public function resendVerification(Request $request, EmailOtpService $otp): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'regex:/^[^@\s]+@gmail\.com$/i'],
        ]);
        $email = strtolower(trim($data['email']));
        $user = User::query()->where('email', $email)->first();

        if ($user && ! $user->email_verified_at) {
            try {
                $otp->issue($user->email, $user->name, EmailOtpService::PURPOSE_REGISTRATION);
            } catch (Throwable $exception) {
                Log::warning('Registration verification resend failed', [
                    'email_hash' => hash('sha256', $email),
                    'exception' => get_class($exception),
                ]);
            }
        }

        return response()->json([
            'message' => 'If an unverified TRANA account exists and its resend limit allows it, a fresh code has been sent.',
            'expires_in' => EmailOtpService::CODE_TTL_MINUTES * 60,
            'resend_after' => EmailOtpService::SEND_COOLDOWN_SECONDS,
        ], 202);
    }

    /** Log in with a username or Gmail address; the token is HttpOnly-cookie only. */
    public function login(Request $request, AuthCookieService $cookies): JsonResponse
    {
        $data = $request->validate([
            'identifier' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'max:255', $this->passwordByteLimitRule()],
        ]);
        $identifier = strtolower(trim($data['identifier']));

        $user = User::query()
            ->where('email', $identifier)
            ->orWhereRaw('lower(username) = ?', [$identifier])
            ->first();
        $hash = $user?->password;
        if (! is_string($hash) || $hash === '') {
            self::$dummyPasswordHash ??= Hash::driver('bcrypt')->make(Str::random(48));
            $hash = self::$dummyPasswordHash;
        }
        $passwordMatches = Hash::driver('bcrypt')->check($data['password'], $hash);

        if (! $user || ! $passwordMatches || $user->isSuspended()) {
            return response()->json(['message' => 'Invalid credentials.'], 401);
        }

        if (! $user->email_verified_at) {
            $challenge = EmailOtpChallenge::query()
                ->where('email', $user->email)
                ->where('purpose', EmailOtpService::PURPOSE_REGISTRATION)
                ->first();
            $now = now();
            $expiresIn = $challenge && $challenge->expires_at->isFuture()
                ? max(0, $challenge->expires_at->getTimestamp() - $now->getTimestamp())
                : 0;
            $resendAfter = $challenge
                ? max(0, $challenge->last_sent_at->getTimestamp() + EmailOtpService::SEND_COOLDOWN_SECONDS - $now->getTimestamp())
                : 0;

            return response()->json([
                'code' => 'EMAIL_NOT_VERIFIED',
                'message' => 'Verify your Gmail address before logging in.',
                'email' => $user->email,
                'expires_in' => $expiresIn,
                'resend_after' => $resendAfter,
            ], 403);
        }

        $minutes = $cookies->lifetimeMinutes();
        $token = $user->createToken('trana-web', ['*'], now()->addMinutes($minutes))->plainTextToken;
        $csrfToken = $cookies->newCsrfToken();

        return response()->json([
            'user' => $this->userPayload($user),
            'csrfToken' => $csrfToken,
        ])->withCookie($cookies->authCookie($token))
            ->withCookie($cookies->csrfCookie($csrfToken));
    }

    /** Do not disclose account existence or mail-provider status to anonymous callers. */
    public function forgotPassword(Request $request, EmailOtpService $otp): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'regex:/^[^@\s]+@gmail\.com$/i'],
        ]);
        $email = strtolower(trim($data['email']));
        $user = User::query()->where('email', $email)->first();

        if ($user?->email_verified_at) {
            try {
                $otp->issue($user->email, $user->name, EmailOtpService::PURPOSE_PASSWORD_RESET);
            } catch (Throwable $exception) {
                Log::warning('Password reset email could not be delivered', [
                    'email_hash' => hash('sha256', $email),
                    'exception' => get_class($exception),
                ]);
            }
        }

        return response()->json([
            'message' => 'If a verified account uses that Gmail address and a new code was available, it has been sent.',
            'expires_in' => EmailOtpService::CODE_TTL_MINUTES * 60,
            'resend_after' => EmailOtpService::SEND_COOLDOWN_SECONDS,
        ], 202);
    }

    /** Verify a password-reset OTP and revoke any existing sessions. */
    public function resetPassword(Request $request, EmailOtpService $otp, AuthCookieService $cookies): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'regex:/^[^@\s]+@gmail\.com$/i'],
            'code' => ['required', 'string', 'regex:/^[0-9]{6}$/'],
            'password' => $this->passwordRules(),
        ]);
        $email = strtolower(trim($data['email']));

        $user = User::query()->where('email', $email)->first();
        if (! $user || ! $user->email_verified_at) {
            throw ValidationException::withMessages([
                'code' => ['That code is invalid, expired, or already used. Request a fresh code and try again.'],
            ]);
        }

        $otp->verify($email, $data['code'], EmailOtpService::PURPOSE_PASSWORD_RESET);

        DB::transaction(function () use ($email, $data): void {
            $user = User::query()->where('email', $email)->lockForUpdate()->first();
            if (! $user || ! $user->email_verified_at) {
                throw ValidationException::withMessages([
                    'code' => ['That code is invalid, expired, or already used. Request a fresh code and try again.'],
                ]);
            }

            $user->password = Hash::driver('bcrypt')->make($data['password']);
            $user->save();
            $user->tokens()->delete();
        });

        [$authCookie, $csrfCookie] = $cookies->forgetCookies();

        return response()->json(['message' => 'Password reset. Log in with your new password.'])
            ->withCookie($authCookie)
            ->withCookie($csrfCookie);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    public function logout(Request $request, AuthCookieService $cookies): JsonResponse
    {
        $request->user()->currentAccessToken()?->delete();

        [$authCookie, $csrfCookie] = $cookies->forgetCookies();

        return response()->json(['message' => 'Logged out.'])
            ->withCookie($authCookie)
            ->withCookie($csrfCookie);
    }

    private function passwordByteLimitRule(): \Closure
    {
        return static function ($attribute, $value, $fail): void {
            // bcrypt uses at most 72 input bytes; reject longer values so
            // distinct long passwords cannot collapse to the same hash.
            if (is_string($value) && strlen($value) > 72) {
                $fail('The password must not exceed 72 bytes when securely hashed.');
            }
        };
    }

    private function passwordRules(): array
    {
        return [
            'required',
            'string',
            'max:255',
            Password::min(8)->letters()->numbers(),
            $this->passwordByteLimitRule(),
            'confirmed',
        ];
    }

    private function cleanName(mixed $name): string
    {
        if (! is_string($name)) {
            return '';
        }

        $clean = strip_tags($name);
        $collapsed = preg_replace('/\s+/u', ' ', trim($clean));

        return is_string($collapsed) ? $collapsed : '';
    }

    private function userPayload(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'username' => $user->username,
            'email' => $user->email,
            'role' => $user->role,
            'verified' => $user->email_verified_at !== null,
            'email_verified_at' => $user->email_verified_at?->toIso8601String(),
            'profile' => $user->fitnessProfile,
            'created_at' => $user->created_at?->toIso8601String(),
        ];
    }
}
