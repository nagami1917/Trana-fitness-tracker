<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuthCookieService;
use App\Services\ErrorMonitor;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** Server-side Google OAuth using authorization code + PKCE. */
class GoogleAuthController extends Controller
{
    private const CALLBACK_PATH = '/api/auth/google/callback';

    /**
     * How long a started sign-in stays valid. Widened from 10 minutes because
     * a first-time Google sign-in has to survive the account chooser, an
     * optional 2FA prompt and consent — and an expired state cookie is
     * indistinguishable from "something blocked me" on the login screen.
     */
    private const STATE_TTL_SECONDS = 1800;

    public function redirect(Request $request): RedirectResponse
    {
        $intentValue = $request->query('intent', 'login');
        $intent = is_string($intentValue) && in_array($intentValue, ['login', 'signup'], true)
            ? $intentValue
            : 'login';

        if (! $this->configured()) {
            return $this->frontendRedirect('not_configured');
        }

        try {
            $verifier = $this->base64Url(random_bytes(64));
            $challenge = $this->base64Url(hash('sha256', $verifier, true));
            // The state carries everything the callback needs, signed. It is
            // deliberately NOT stored in a cookie: a cookie can hold only one
            // value, so a second tab, a retry or a Back navigation overwrote
            // the first attempt's state and the earlier callback then failed
            // validation — the user saw "sign-in could not be completed" with
            // no way to tell why.
            $state = $this->signState([
                'v' => $verifier,
                'i' => $intent,
                't' => time(),
                'n' => bin2hex(random_bytes(8)),
            ]);

            $query = http_build_query([
                'client_id' => config('services.google.client_id'),
                'redirect_uri' => config('services.google.redirect'),
                'response_type' => 'code',
                'scope' => 'openid email profile',
                'state' => $state,
                'code_challenge' => $challenge,
                'code_challenge_method' => 'S256',
                'prompt' => 'select_account',
            ], '', '&', PHP_QUERY_RFC3986);

            return redirect()->away(rtrim((string) config('services.google.authorization_url'), '?').'?'.$query)
                ->header('Cache-Control', 'no-store');
        } catch (Throwable $exception) {
            Log::warning('Google sign-in could not be started', [
                'exception' => get_class($exception),
            ]);
            // Persisted as well as logged: Vercel's request logs are ephemeral,
            // so a failure that only logs cannot be investigated afterwards.
            ErrorMonitor::recordOAuthFailure('redirect', $exception);

            return $this->frontendRedirect('failed');
        }
    }

    public function callback(Request $request, AuthCookieService $cookies): RedirectResponse
    {
        $state = $this->consumeState($request);
        if (! $state) {
            // Distinguish "Google sent us nothing" from "what it sent does not
            // verify": the first means the round trip broke, the second means
            // the signature or the clock did.
            ErrorMonitor::recordOAuthFailure(
                is_string($request->query('state')) && $request->query('state') !== ''
                    ? 'state_invalid'
                    : 'state_missing'
            );

            return $this->frontendRedirect('failed');
        }

        $providerError = $request->query('error');
        if (is_string($providerError) && $providerError !== '') {
            $status = $providerError === 'access_denied' ? 'cancelled' : 'failed';
            if ($status === 'failed') {
                // A cancellation is user intent; anything else is a real fault.
                ErrorMonitor::recordOAuthFailure('provider:'.substr($providerError, 0, 40));
            }

            return $this->frontendRedirect($status);
        }

        if (! $this->configured()) {
            return $this->frontendRedirect('not_configured');
        }

        $code = $request->query('code');
        if (! is_string($code) || $code === '' || strlen($code) > 2048) {
            return $this->frontendRedirect('failed');
        }

        $failureStage = 'token_exchange';
        try {
            $tokenResponse = Http::asForm()
                ->acceptJson()
                ->timeout(10)
                ->post((string) config('services.google.token_url'), [
                    'client_id' => config('services.google.client_id'),
                    'client_secret' => config('services.google.client_secret'),
                    'code' => $code,
                    'code_verifier' => $state['verifier'],
                    'grant_type' => 'authorization_code',
                    'redirect_uri' => config('services.google.redirect'),
                ]);

            if (! $tokenResponse->successful()) {
                throw new RuntimeException('Google authorization code exchange failed.');
            }

            $accessToken = $tokenResponse->json('access_token');
            if (! is_string($accessToken) || $accessToken === '') {
                throw new RuntimeException('Google did not return an access token.');
            }

            $failureStage = 'userinfo_fetch';
            $profileResponse = Http::withToken($accessToken)
                ->acceptJson()
                ->timeout(10)
                ->get((string) config('services.google.userinfo_url'));

            if (! $profileResponse->successful()) {
                throw new RuntimeException('Google user information could not be retrieved.');
            }

            $profile = $profileResponse->json();
            if (! is_array($profile)) {
                throw new RuntimeException('Google returned an invalid account profile.');
            }

            $googleSub = $profile['sub'] ?? null;
            $emailValue = $profile['email'] ?? null;
            $email = is_string($emailValue) ? strtolower(trim($emailValue)) : '';
            $emailVerified = ($profile['email_verified'] ?? false) === true;
            if (! is_string($googleSub) || $googleSub === '' || strlen($googleSub) > 255
                || strlen($email) > 255 || ! filter_var($email, FILTER_VALIDATE_EMAIL) || ! $emailVerified) {
                return $this->frontendRedirect('unverified_email');
            }

            $nameValue = $profile['name'] ?? null;
            $name = is_string($nameValue) ? trim(strip_tags($nameValue)) : '';
            if ($name === '') {
                $name = (string) Str::before($email, '@');
            }
            $name = mb_substr($name, 0, 80);

            $failureStage = 'account_resolution';
            $user = $this->resolveAccount($googleSub, $email, $name, $state['intent'] === 'signup');
            if (! $user) {
                return $this->frontendRedirect('account_not_found');
            }
            if ($user->isSuspended()) {
                return $this->frontendRedirect('account_unavailable');
            }

            $failureStage = 'session_issue';
            $token = $user->createToken(
                'trana-web',
                ['*'],
                now()->addMinutes($cookies->lifetimeMinutes()),
            )->plainTextToken;
            $csrfToken = $cookies->newCsrfToken();

            return redirect()->away(rtrim((string) config('frontend.url'), '/').'/')
                ->withCookie($cookies->authCookie($token))
                ->withCookie($cookies->csrfCookie($csrfToken))
                
                ->header('Cache-Control', 'no-store');
        } catch (Throwable $exception) {
            Log::warning('Google sign-in callback failed', [
                'stage' => $failureStage,
                'exception' => get_class($exception),
            ]);
            ErrorMonitor::recordOAuthFailure($failureStage, $exception);

            return $this->frontendRedirect('failed');
        }
    }

    private function resolveAccount(string $googleSub, string $email, string $name, bool $allowCreate): ?User
    {
        return DB::transaction(function () use ($googleSub, $email, $name, $allowCreate): ?User {
            $googleUser = User::query()
                ->where('google_sub', $googleSub)
                ->lockForUpdate()
                ->first();
            $emailUser = User::query()
                ->where('email', $email)
                ->lockForUpdate()
                ->first();

            if ($googleUser && $emailUser && $googleUser->id !== $emailUser->id) {
                throw new RuntimeException('Google identity conflicts with an existing account.');
            }

            $user = $googleUser ?? $emailUser;
            if ($user?->isSuspended()) {
                return $user;
            }
            if ($user && is_string($user->google_sub) && $user->google_sub !== ''
                && ! hash_equals($user->google_sub, $googleSub)) {
                throw new RuntimeException('Google identity conflicts with an existing account.');
            }

            if (! $user) {
                if (! $allowCreate) {
                    return null;
                }

                $user = new User();
                $user->forceFill([
                    'name' => $name,
                    'email' => $email,
                    'username' => null,
                    'password' => Hash::driver('bcrypt')->make(Str::random(64)),
                    'role' => User::ROLE_ATHLETE,
                    'email_verified_at' => now(),
                    'google_sub' => $googleSub,
                ])->save();
            } else {
                // Google has verified this email. Link a matching legacy email
                // account, or keep an existing Google account's updated email,
                // but never merge two different database accounts.
                if ($user->email !== $email) {
                    if ($emailUser && $emailUser->id !== $user->id) {
                        throw new RuntimeException('Google email conflicts with an existing account.');
                    }
                    $user->email = $email;
                }
                $user->email_verified_at = $user->email_verified_at ?? now();
                $user->forceFill(['google_sub' => $googleSub])->save();
            }

            if (! $user->username) {
                $user->username = $this->usernameFor($email, (int) $user->id);
                $user->save();
            }

            $user->ensureProfile();
            $user->ensureGoals();

            return $user->fresh();
        });
    }

    private function usernameFor(string $email, int $userId): string
    {
        $base = strtolower((string) Str::before($email, '@'));
        $base = preg_replace('/[^a-z0-9_]+/', '_', $base) ?? '';
        $base = trim($base, '_');
        if (strlen($base) < 3) {
            $base = 'athlete';
        }

        $attempt = 0;
        do {
            $suffix = '_'.base_convert((string) $userId, 10, 36)
                .($attempt > 0 ? '_'.base_convert((string) $attempt, 10, 36) : '');
            if (strlen($suffix) > 17) {
                $suffix = '_'.substr(hash('sha256', $userId.':'.$attempt), 0, 12);
            }
            $candidate = substr($base, 0, 20 - strlen($suffix)).$suffix;
            $attempt++;
        } while (User::query()->where('username', $candidate)->exists());

        return $candidate;
    }

    /**
     * Verify the signed state Google echoed back.
     *
     * The payload is authenticated, not encrypted: it holds a PKCE verifier and
     * a timestamp, neither of which is a secret from the person reading their
     * own address bar — but nobody can mint one without APP_KEY, so a forged or
     * tampered callback is rejected exactly like before.
     *
     * @return array{verifier: string, intent: string}|null
     */
    private function consumeState(Request $request): ?array
    {
        $state = $request->query('state');
        if (! is_string($state) || $state === '' || strlen($state) > 1024) {
            return null;
        }

        $parts = explode('.', $state);
        if (count($parts) !== 3) {
            return null;
        }
        [$version, $encoded, $mac] = $parts;
        if ($version !== 'v1' || ! is_string($encoded) || ! is_string($mac)) {
            return null;
        }

        $expected = hash_hmac('sha256', $version.'.'.$encoded, $this->stateKey());
        if (! hash_equals($expected, $mac)) {
            return null;
        }

        $json = $this->base64UrlDecode($encoded);
        if ($json === null) {
            return null;
        }

        try {
            $payload = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return null;
        }
        if (! is_array($payload)) {
            return null;
        }

        $intent = $payload['i'] ?? null;
        $verifier = $payload['v'] ?? null;
        $issuedAt = $payload['t'] ?? null;

        if (! is_string($intent) || ! in_array($intent, ['login', 'signup'], true)
            || ! is_string($verifier)
            || strlen($verifier) < 43 || strlen($verifier) > 128
            || ! is_int($issuedAt)
            || $issuedAt > time() + 60
            || time() - $issuedAt > self::STATE_TTL_SECONDS) {
            return null;
        }

        return ['verifier' => $verifier, 'intent' => $intent];
    }

    /** @param array<string, mixed> $payload */
    private function signState(array $payload): string
    {
        $encoded = $this->base64Url(json_encode($payload, JSON_THROW_ON_ERROR));

        return 'v1.'.$encoded.'.'.hash_hmac('sha256', 'v1.'.$encoded, $this->stateKey());
    }

    /** APP_KEY-derived, so no new deployment secret is required. */
    private function stateKey(): string
    {
        return hash_hmac('sha256', 'trana-google-oauth-state', (string) config('app.key'), true);
    }

    private function base64UrlDecode(string $value): ?string
    {
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);

        return $decoded === false ? null : $decoded;
    }

    private function configured(): bool
    {
        foreach (['client_id', 'client_secret', 'redirect', 'authorization_url', 'token_url', 'userinfo_url'] as $key) {
            $value = config('services.google.'.$key);
            if (! is_string($value) || trim($value) === '') {
                return false;
            }
        }

        return true;
    }

    private function frontendRedirect(string $status): RedirectResponse
    {
        $allowed = ['failed', 'cancelled', 'not_configured', 'unverified_email', 'account_unavailable', 'account_not_found'];
        $status = in_array($status, $allowed, true) ? $status : 'failed';
        $url = rtrim((string) config('frontend.url'), '/').'/login?google='.rawurlencode($status);

        return redirect()->away($url)->header('Cache-Control', 'no-store');
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
