<?php

namespace App\Services;

use App\Models\EmailOtpChallenge;
use App\Models\User;
use App\Notifications\EmailOtpNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/** Issues and consumes hashed, short-lived email one-time codes. */
class EmailOtpService
{
    public const PURPOSE_REGISTRATION = 'registration';

    public const PURPOSE_LOGIN = 'login';

    public const PURPOSE_ACCOUNT_DELETION = 'account_deletion';

    public const CODE_TTL_MINUTES = 10;

    public const MAX_ATTEMPTS = 5;

    public const SEND_COOLDOWN_SECONDS = 60;

    public const MAX_SENDS_PER_HOUR = 5;

    /**
     * Return false when the per-email cooldown / hourly limit suppresses a send.
     * The caller decides whether that state is visible (registration / account
     * deletion) or should get the same generic answer as a missing login.
     */
    public function issue(string $email, ?string $name, string $purpose): bool
    {
        $email = $this->normalizeEmail($email);
        $this->assertRealProductionMailer();

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $now = now();
        $codeHash = $this->hashCode($email, $purpose, $code);

        $issue = DB::transaction(function () use ($email, $name, $purpose, $codeHash, $now): array {
            // Keep the challenge table bounded without requiring a scheduled job.
            EmailOtpChallenge::query()
                ->where('expires_at', '<', $now->copy()->subDay())
                ->delete();

            $challenge = EmailOtpChallenge::query()
                ->where('email', $email)
                ->lockForUpdate()
                ->first();

            $challengeStillUsable = $challenge
                && (int) $challenge->attempts < self::MAX_ATTEMPTS
                && $challenge->expires_at->gt($now);
            if ($challengeStillUsable
                && $challenge->purpose === $purpose
                && $challenge->last_sent_at?->gt($now->copy()->subSeconds(self::SEND_COOLDOWN_SECONDS))) {
                return ['sent' => false];
            }

            $windowStartedAt = $challenge?->send_window_started_at;
            $sendCount = (int) ($challenge?->send_count ?? 0);
            if (! $windowStartedAt || $windowStartedAt->lte($now->copy()->subHour())) {
                $windowStartedAt = $now;
                $sendCount = 1;
            } else {
                if ($sendCount >= self::MAX_SENDS_PER_HOUR) {
                    return ['sent' => false];
                }
                $sendCount++;
            }

            $challenge ??= new EmailOtpChallenge();
            $challenge->fill([
                'email' => $email,
                'name' => $name,
                'purpose' => $purpose,
                'code_hash' => $codeHash,
                'expires_at' => $now->copy()->addMinutes(self::CODE_TTL_MINUTES),
                'attempts' => 0,
                'send_count' => $sendCount,
                'send_window_started_at' => $windowStartedAt,
                'last_sent_at' => $now,
            ]);
            $challenge->save();

            return ['sent' => true];
        });

        if (! $issue['sent']) {
            return false;
        }

        try {
            Notification::route('mail', $email)->notify(new EmailOtpNotification(
                $code,
                $name ?: 'TRANA athlete',
                $purpose,
            ));
        } catch (Throwable $exception) {
            // Do not leave a usable code behind when the transport rejects mail.
            try {
                EmailOtpChallenge::query()
                    ->where('email', $email)
                    ->where('code_hash', $codeHash)
                    ->update([
                        'attempts' => self::MAX_ATTEMPTS,
                        'expires_at' => now()->subSecond(),
                        'name' => null,
                    ]);
            } catch (Throwable) {
                // Preserve the original delivery exception for the controller log.
            }

            throw $exception;
        }

        return true;
    }

    /** Validate a login/registration code and return its newly issued session. */
    public function verify(string $email, string $code): array
    {
        $email = $this->normalizeEmail($email);

        $result = DB::transaction(function () use ($email, $code): array {
            $challenge = EmailOtpChallenge::query()
                ->where('email', $email)
                ->lockForUpdate()
                ->first();

            if (! $challenge) {
                return ['invalid' => true];
            }

            if ($challenge->expires_at->isPast() || (int) $challenge->attempts >= self::MAX_ATTEMPTS) {
                $this->invalidateChallenge($challenge);

                return ['invalid' => true];
            }

            // A code sent for account deletion can never be used to sign in.
            if (! in_array($challenge->purpose, [self::PURPOSE_REGISTRATION, self::PURPOSE_LOGIN], true)) {
                $this->recordFailedAttempt($challenge);

                return ['invalid' => true];
            }

            $expectedHash = $this->hashCode($email, $challenge->purpose, $code);
            if (! hash_equals($challenge->code_hash, $expectedHash)) {
                $this->recordFailedAttempt($challenge);

                return ['invalid' => true];
            }

            if ($challenge->purpose === self::PURPOSE_REGISTRATION) {
                // The request is rechecked while holding the challenge lock so
                // a concurrent registration cannot create a duplicate account.
                if (User::query()->where('email', $email)->exists()) {
                    $this->invalidateChallenge($challenge);

                    return ['invalid' => true];
                }

                $user = User::create([
                    'name' => $challenge->name,
                    'email' => $email,
                    'password' => null,
                ]);
                $user->forceFill(['email_verified_at' => now()])->save();
            } else {
                $user = User::query()->where('email', $email)->first();
                if (! $user || $user->isSuspended()) {
                    $this->invalidateChallenge($challenge);

                    return ['invalid' => true];
                }
                if (! $user->email_verified_at) {
                    $user->forceFill(['email_verified_at' => now()])->save();
                }
            }

            $user->ensureProfile();
            $user->ensureGoals();
            $token = $user->createToken('pwa')->plainTextToken;
            $this->invalidateChallenge($challenge);

            return ['token' => $token, 'user' => $user];
        });

        if (isset($result['invalid'])) {
            throw ValidationException::withMessages([
                'code' => ['That code is invalid or expired. Request a fresh one and try again.'],
            ]);
        }

        return $result;
    }

    /** Consume a fresh code sent specifically for account deletion. */
    public function verifyAccountDeletionCode(string $email, string $code): void
    {
        $email = $this->normalizeEmail($email);

        $valid = DB::transaction(function () use ($email, $code): bool {
            $challenge = EmailOtpChallenge::query()
                ->where('email', $email)
                ->lockForUpdate()
                ->first();

            if (! $challenge) {
                return false;
            }
            if ($challenge->expires_at->isPast() || (int) $challenge->attempts >= self::MAX_ATTEMPTS) {
                $this->invalidateChallenge($challenge);

                return false;
            }
            if ($challenge->purpose !== self::PURPOSE_ACCOUNT_DELETION) {
                $this->recordFailedAttempt($challenge);

                return false;
            }

            $expectedHash = $this->hashCode($email, $challenge->purpose, $code);
            if (! hash_equals($challenge->code_hash, $expectedHash)) {
                $this->recordFailedAttempt($challenge);

                return false;
            }

            $this->invalidateChallenge($challenge);

            return true;
        });

        if (! $valid) {
            throw ValidationException::withMessages([
                'code' => ['That code is invalid or expired. Request a fresh one and try again.'],
            ]);
        }
    }

    /** Keep the send-window counters after a code is used or expires. */
    private function invalidateChallenge(EmailOtpChallenge $challenge): void
    {
        $challenge->attempts = self::MAX_ATTEMPTS;
        $challenge->expires_at = now()->subSecond();
        $challenge->name = null;
        $challenge->save();
    }

    private function recordFailedAttempt(EmailOtpChallenge $challenge): void
    {
        $challenge->attempts = (int) $challenge->attempts + 1;
        if ((int) $challenge->attempts >= self::MAX_ATTEMPTS) {
            $this->invalidateChallenge($challenge);

            return;
        }

        $challenge->save();
    }

    private function normalizeEmail(string $email): string
    {
        return strtolower(trim($email));
    }

    private function hashCode(string $email, string $purpose, string $code): string
    {
        $key = config('app.key');
        if (! is_string($key) || $key === '') {
            throw new RuntimeException('APP_KEY must be configured before email codes can be issued.');
        }

        // HMAC prevents a database-only leak from enabling an offline search of
        // the six-digit code space. Limit attempts on the server as well.
        return hash_hmac('sha256', $email."\0".$purpose."\0".$code, $key);
    }

    private function assertRealProductionMailer(): void
    {
        if (! app()->environment('production')) {
            return;
        }

        $mailer = config('mail.default');
        if (! is_string($mailer) || in_array($mailer, ['log', 'array'], true)) {
            throw new RuntimeException('Production email OTP delivery requires a real mail transport.');
        }

        if ($mailer === 'smtp') {
            $host = strtolower((string) config('mail.mailers.smtp.host'));
            $from = strtolower((string) config('mail.from.address'));
            if ($host === '' || in_array($host, ['127.0.0.1', 'localhost', 'smtp.example.com'], true)
                || ! filter_var($from, FILTER_VALIDATE_EMAIL) || str_ends_with($from, '@example.com')) {
                throw new RuntimeException('Production SMTP host and sender address must be configured.');
            }
        }
    }
}
