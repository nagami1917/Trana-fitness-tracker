<?php

namespace Tests\Feature;

use App\Models\EmailOtpChallenge;
use App\Models\User;
use App\Services\EmailOtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\Support\AuthTestHelpers;
use Tests\Support\EmailOtpTestHelpers;
use Tests\TestCase;

class EmailPasswordAuthTest extends TestCase
{
    use RefreshDatabase;
    use AuthTestHelpers;
    use EmailOtpTestHelpers;

    public function test_registration_saves_an_unverified_bcrypt_account_and_verification_uses_a_hashed_five_minute_code(): void
    {
        Notification::fake();
        $response = $this->postJson('/api/auth/register', [
            'name' => '<b>Ana</b> Runner',
            'username' => 'AnaRunner_7',
            'email' => 'ANA.RUNNER@gmail.com',
            'password' => 'Runner-pass-123',
            'password_confirmation' => 'Runner-pass-123',
        ])->assertAccepted()
            ->assertJsonPath('email', 'ana.runner@gmail.com')
            ->assertJsonMissingPath('token');

        $user = User::query()->where('email', 'ana.runner@gmail.com')->firstOrFail();
        $this->assertSame('Ana Runner', $user->name);
        $this->assertSame('anarunner_7', $user->username);
        $this->assertNull($user->email_verified_at);
        $this->assertSame('bcrypt', password_get_info($user->password)['algoName']);
        $this->assertTrue(Hash::driver('bcrypt')->check('Runner-pass-123', $user->password));

        $challenge = EmailOtpChallenge::query()->where('email', $user->email)->firstOrFail();
        $code = $this->sentOtpCodeFor($user->email);
        $this->assertNotSame($code, $challenge->code_hash);
        $this->assertSame(0, (int) $challenge->attempts);
        $this->assertSame(EmailOtpService::PURPOSE_REGISTRATION, $challenge->purpose);
        $this->assertTrue($challenge->expires_at->between(now()->addMinutes(4), now()->addMinutes(5)));

        $this->travel(6)->minutes();
        $this->postJson('/api/auth/email/verify', [
            'email' => $user->email,
            'code' => $code,
        ])->assertUnprocessable()->assertJsonValidationErrors(['code']);
        $this->assertNull($user->fresh()->email_verified_at);
        $this->assertDatabaseMissing('fitness_profiles', ['user_id' => $user->id]);

        $this->postJson('/api/auth/email/resend', ['email' => $user->email])->assertAccepted();
        $code = $this->sentOtpCodeFor($user->email);
        $this->postJson('/api/auth/email/verify', [
            'email' => $user->email,
            'code' => $code,
        ])->assertOk()->assertJsonPath('verified', true);
        $this->postJson('/api/auth/email/verify', [
            'email' => $user->email,
            'code' => $code,
        ])->assertUnprocessable()->assertJsonValidationErrors(['code']);
        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->assertDatabaseHas('fitness_profiles', ['user_id' => $user->id]);
        $this->assertDatabaseHas('goals', ['user_id' => $user->id]);
        $this->assertSame(0, $user->fresh()->tokens()->count(), 'Verification sends the user to the login screen.');
    }

    public function test_registration_returns_a_recoverable_response_when_the_verification_mailer_fails(): void
    {
        $email = 'mail-failure@gmail.com';
        $otp = \Mockery::mock(EmailOtpService::class);
        $otp->shouldReceive('issue')
            ->once()
            ->with($email, 'Mail Failure Athlete', EmailOtpService::PURPOSE_REGISTRATION)
            ->andThrow(new \RuntimeException('SMTP unavailable in this test.'));
        $this->app->instance(EmailOtpService::class, $otp);

        $this->postJson('/api/auth/register', [
            'name' => 'Mail Failure Athlete',
            'username' => 'mail_failure',
            'email' => $email,
            'password' => 'Mail-failure-123',
            'password_confirmation' => 'Mail-failure-123',
        ])->assertStatus(503)
            ->assertJsonPath('code', 'EMAIL_VERIFICATION_UNAVAILABLE')
            ->assertJsonPath('email', $email)
            ->assertJsonPath('expires_in', 0)
            ->assertJsonMissingPath('token');

        $user = User::query()->where('email', $email)->firstOrFail();
        $this->assertNull($user->email_verified_at, 'A delivery failure must never verify the new account.');
        $this->assertSame(0, $user->tokens()->count(), 'A delivery failure must not create an authenticated session.');
        $this->assertDatabaseMissing('email_otp_challenges', ['email' => $email]);

        $this->postJson('/api/auth/login', [
            'identifier' => 'mail_failure',
            'password' => 'Mail-failure-123',
        ])->assertForbidden()->assertJsonPath('code', 'EMAIL_NOT_VERIFIED');
    }

    public function test_signup_enforces_unique_username_gmail_and_password_rules(): void
    {
        Notification::fake();
        $valid = [
            'name' => 'First Athlete',
            'username' => 'first_runner',
            'email' => 'first@gmail.com',
            'password' => 'Strong-pass-123',
            'password_confirmation' => 'Strong-pass-123',
        ];
        $this->postJson('/api/auth/register', $valid)->assertAccepted();

        $this->postJson('/api/auth/register', array_merge($valid, [
            'email' => 'another@gmail.com',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['username']);

        $this->postJson('/api/auth/register', array_merge($valid, [
            'username' => 'another_runner',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['email']);

        $this->postJson('/api/auth/register', array_merge($valid, [
            'username' => 'valid_user',
            'email' => 'runner@example.com',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['email']);

        $this->postJson('/api/auth/register', array_merge($valid, [
            'username' => 'bad-name',
            'email' => 'second@gmail.com',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['username']);

        $this->postJson('/api/auth/register', array_merge($valid, [
            'username' => 'second_runner',
            'email' => 'second@gmail.com',
            'password' => 'short7',
            'password_confirmation' => 'short7',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['password']);

        $this->postJson('/api/auth/register', array_merge($valid, [
            'username' => 'third_runner',
            'email' => 'third@gmail.com',
            'password' => '12345678',
            'password_confirmation' => '12345678',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['password']);

        $this->postJson('/api/auth/register', array_merge($valid, [
            'username' => 'fourth_runner',
            'email' => 'fourth@gmail.com',
            'password' => 'abcdefgh',
            'password_confirmation' => 'abcdefgh',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['password']);

        $this->postJson('/api/auth/register', array_merge($valid, [
            'username' => 'fifth_runner',
            'email' => 'fifth@gmail.com',
            'password_confirmation' => 'Different-pass-456',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['password']);

        $longPassword = str_repeat('a', 72).'1';
        $this->postJson('/api/auth/register', array_merge($valid, [
            'username' => 'long_password',
            'email' => 'long@gmail.com',
            'password' => $longPassword,
            'password_confirmation' => $longPassword,
        ]))->assertUnprocessable()->assertJsonValidationErrors(['password']);
    }

    public function test_login_uses_username_or_gmail_rejects_unverified_accounts_and_keeps_failures_generic(): void
    {
        Notification::fake();
        $this->postJson('/api/auth/register', [
            'name' => 'Pending Athlete',
            'username' => 'pending_runner',
            'email' => 'pending@gmail.com',
            'password' => 'Pending-pass-123',
            'password_confirmation' => 'Pending-pass-123',
        ])->assertAccepted();

        $this->postJson('/api/auth/login', [
            'identifier' => 'pending_runner',
            'password' => 'wrong-password-1',
        ])->assertUnauthorized()->assertJsonPath('message', 'Invalid credentials.');

        $this->postJson('/api/auth/login', [
            'identifier' => 'pending_runner',
            'password' => 'Pending-pass-123',
        ])->assertForbidden()
            ->assertJsonPath('code', 'EMAIL_NOT_VERIFIED')
            ->assertJsonPath('email', 'pending@gmail.com');

        $this->postJson('/api/auth/login', [
            'identifier' => 'missing@gmail.com',
            'password' => 'Pending-pass-123',
        ])->assertUnauthorized()->assertJsonPath('message', 'Invalid credentials.');
        $this->postJson('/api/auth/login', [
            'identifier' => 'pending_runner',
            'password' => str_repeat('a', 72).'1',
        ])->assertUnprocessable()->assertJsonValidationErrors(['password']);

        $code = $this->sentOtpCodeFor('pending@gmail.com');
        $this->postJson('/api/auth/email/verify', [
            'email' => 'pending@gmail.com', 'code' => $code,
        ])->assertOk();

        $login = $this->postJson('/api/auth/login', [
            'identifier' => 'pending_runner',
            'password' => 'Pending-pass-123',
        ])->assertOk()
            ->assertJsonPath('user.username', 'pending_runner')
            ->assertJsonMissingPath('token');

        $cookie = $login->getCookie('trana_session', decrypt: false);
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('/api', $cookie->getPath());
        $this->assertMatchesRegularExpression('/^[0-9]+\|[A-Za-z0-9]+$/', $cookie->getValue());

        app('auth')->forgetGuards();
        $this->withCredentials()->withUnencryptedCookies(['trana_session' => $cookie->getValue()])
            ->getJson('/api/auth/me')
            ->assertOk()->assertJsonPath('user.username', 'pending_runner');
    }

    public function test_five_wrong_codes_invalidate_the_challenge_and_a_resend_issues_a_new_code(): void
    {
        Notification::fake();
        $this->postJson('/api/auth/register', [
            'name' => 'Code Athlete',
            'username' => 'code_athlete',
            'email' => 'code@gmail.com',
            'password' => 'Code-pass-123',
            'password_confirmation' => 'Code-pass-123',
        ])->assertAccepted();

        $actualCode = $this->sentOtpCodeFor('code@gmail.com');
        $wrongCode = $actualCode === '000000' ? '000001' : '000000';
        for ($attempt = 0; $attempt < EmailOtpService::MAX_ATTEMPTS; $attempt++) {
            $this->postJson('/api/auth/email/verify', [
                'email' => 'code@gmail.com',
                'code' => $wrongCode,
            ])->assertUnprocessable()->assertJsonValidationErrors(['code']);
        }
        $this->assertSame(EmailOtpService::MAX_ATTEMPTS, (int) EmailOtpChallenge::query()->where('email', 'code@gmail.com')->value('attempts'));
        $this->postJson('/api/auth/email/verify', [
            'email' => 'code@gmail.com',
            'code' => $actualCode,
        ])->assertUnprocessable()->assertJsonValidationErrors(['code']);

        // The endpoint stays enumeration-safe but the service must not issue a
        // second notification until the 60-second cooldown has elapsed.
        $this->postJson('/api/auth/email/resend', ['email' => 'code@gmail.com'])->assertAccepted();
        $this->assertSame(1, (int) EmailOtpChallenge::query()->where('email', 'code@gmail.com')->value('send_count'));

        $this->travel(61)->seconds();
        $this->postJson('/api/auth/email/resend', ['email' => 'code@gmail.com'])->assertAccepted();
        $this->assertSame(2, (int) EmailOtpChallenge::query()->where('email', 'code@gmail.com')->value('send_count'));
        $newCode = $this->sentOtpCodeFor('code@gmail.com');
        $this->assertNotSame($actualCode, $newCode);
        $this->postJson('/api/auth/email/verify', [
            'email' => 'code@gmail.com',
            'code' => $newCode,
        ])->assertOk();
    }

    public function test_password_reset_uses_email_code_and_revokes_existing_tokens(): void
    {
        Notification::fake();
        $account = $this->createVerifiedAccount('Reset Athlete', 'reset@gmail.com');
        $user = User::findOrFail($account['user']['id']);

        $this->postJson('/api/auth/password/forgot', ['email' => $user->email])->assertAccepted();
        $code = $this->sentOtpCodeFor($user->email);
        $this->assertSame(1, $user->tokens()->count());

        $this->postJson('/api/auth/password/reset', [
            'email' => $user->email,
            'code' => $code,
            'password' => 'Replacement-pass-456',
            'password_confirmation' => 'Replacement-pass-456',
        ])->assertOk()->assertJsonMissingPath('token');

        $this->assertSame(0, $user->fresh()->tokens()->count());
        $this->postJson('/api/auth/login', [
            'identifier' => 'reset@gmail.com',
            'password' => 'Fixture-password-123',
        ])->assertUnauthorized()->assertJsonPath('message', 'Invalid credentials.');
        $this->postJson('/api/auth/login', [
            'identifier' => 'reset@gmail.com',
            'password' => 'Replacement-pass-456',
        ])->assertOk()->assertJsonPath('user.email', 'reset@gmail.com');
    }

    public function test_production_auth_cookies_are_secure_and_default_to_cross_site_compatible_samesite(): void
    {
        $account = $this->createVerifiedAccount('Secure Athlete', 'secure@gmail.com');
        $previousEnvironment = app()->environment();
        $previousSameSite = config('services.trana.cookie_same_site');
        app()->instance('env', 'production');
        config(['services.trana.cookie_same_site' => null]);

        try {
            $response = $this->postJson('/api/auth/login', [
                'identifier' => $account['user']['username'],
                'password' => 'Fixture-password-123',
            ])->assertOk();
            $cookie = $response->getCookie('trana_session', decrypt: false);
            $csrfCookie = $response->getCookie('trana_csrf', decrypt: false);
            $this->assertNotNull($cookie);
            $this->assertNotNull($csrfCookie);
            $this->assertTrue($cookie->isSecure());
            $this->assertTrue($cookie->isHttpOnly());
            $this->assertSame('none', $cookie->getSameSite());
            $this->assertTrue($csrfCookie->isSecure());
            $this->assertSame('none', $csrfCookie->getSameSite());
        } finally {
            app()->instance('env', $previousEnvironment);
            config(['services.trana.cookie_same_site' => $previousSameSite]);
        }
    }

    public function test_operator_can_close_password_signup_without_affecting_google_or_login(): void
    {
        // A deployment with no working mailer cannot verify new accounts, so it
        // may close the registration form and create accounts server-side with
        // `php artisan account:confirm`. Existing sign-in must keep working.
        Notification::fake();
        config(['services.trana.allow_password_signup' => false]);

        $this->postJson('/api/auth/register', [
            'name' => 'Closed Signup',
            'username' => 'closed_signup',
            'email' => 'closed@gmail.com',
            'password' => 'Runner-pass-123',
            'password_confirmation' => 'Runner-pass-123',
        ])->assertForbidden()
            ->assertJsonPath('code', 'SIGNUP_DISABLED');

        $this->assertDatabaseMissing('users', ['email' => 'closed@gmail.com']);
        Notification::assertNothingSent();

        // Password login is independent of the flag.
        $this->createVerifiedAccount('Existing Athlete', 'existing@gmail.com');
        $this->postJson('/api/auth/login', [
            'identifier' => 'existing@gmail.com',
            'password' => self::FIXTURE_PASSWORD,
        ])->assertOk();

        config(['services.trana.allow_password_signup' => true]);
        $this->postJson('/api/auth/register', [
            'name' => 'Reopened Signup',
            'username' => 'reopened_signup',
            'email' => 'reopened@gmail.com',
            'password' => 'Runner-pass-123',
            'password_confirmation' => 'Runner-pass-123',
        ])->assertAccepted();
    }

    /**
     * The transport guard used to check only the host and the sender address.
     * Production shipped with `MAIL_USERNAME=your-gmail@gmail.com` and an empty
     * MAIL_PASSWORD, which satisfies both of those and authenticates as nobody,
     * so every send failed.
     *
     * The account is deliberately written before the send. That is not the
     * failure it looks like: the registration response explains what happened,
     * and logging in without verifying answers EMAIL_NOT_VERIFIED with
     * expires_in 0, which the login page turns into "use Log in with Google" -
     * the callback links that identity onto this row and marks it verified. So
     * the row is the rescue path. Production stranded nobody with it: the table
     * never held a single challenge.
     *
     * What the widened guard buys is a clear failure before any of that.
     */
    public function test_registration_refuses_when_smtp_credentials_are_unusable(): void
    {
        // assertRealProductionMailer() returns early outside production, so this
        // asserts the guard on its production path. app()->instance('env', ...)
        // is how the rest of this suite does that (see the cookie tests).
        config(['services.trana.allow_password_signup' => true]);
        $previousEnvironment = app()->environment();
        $previousMail = config('mail');
        app()->instance('env', 'production');

        $attempt = 0;
        $register = function () use (&$attempt) {
            $attempt++;

            return $this->postJson('/api/auth/register', [
                'name' => 'Guard Athlete',
                'username' => 'guard_athlete'.$attempt,
                'email' => 'guard_athlete'.$attempt.'@gmail.com',
                'password' => 'Runner-pass-123',
                'password_confirmation' => 'Runner-pass-123',
            ]);
        };

        try {
            config(['mail.default' => 'smtp']);
            config(['mail.mailers.smtp.host' => 'smtp.gmail.com']);
            config(['mail.from.address' => 'operator@gmail.com']);

            // 1. The exact production defect: the documentation sample value.
            config(['mail.mailers.smtp.username' => 'your-gmail@gmail.com']);
            config(['mail.mailers.smtp.password' => 'an-app-password']);
            $register()->assertStatus(503)
                ->assertJsonPath('code', 'EMAIL_VERIFICATION_UNAVAILABLE')
                ->assertJsonPath('email', 'guard_athlete1@gmail.com')
                ->assertJsonPath('expires_in', 0);
            $this->assertDatabaseMissing('email_otp_challenges', ['email' => 'guard_athlete1@gmail.com']);

            // 2. An empty username is not a mailbox either.
            config(['mail.mailers.smtp.username' => '']);
            $register()->assertStatus(503)
                ->assertJsonPath('code', 'EMAIL_VERIFICATION_UNAVAILABLE');

            // 3. Correct mailbox, no password: still cannot authenticate.
            config(['mail.mailers.smtp.username' => 'operator@gmail.com']);
            config(['mail.mailers.smtp.password' => '']);
            $register()->assertStatus(503)
                ->assertJsonPath('code', 'EMAIL_VERIFICATION_UNAVAILABLE');

            // 4. A complete configuration gets past the guard and registers.
            config(['mail.mailers.smtp.password' => 'an-app-password']);
            $register()->assertAccepted()
                ->assertJsonPath('email', 'guard_athlete4@gmail.com');
        } finally {
            app()->instance('env', $previousEnvironment);
            config(['mail' => $previousMail]);
        }
    }
}
