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
        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->assertDatabaseHas('fitness_profiles', ['user_id' => $user->id]);
        $this->assertDatabaseHas('goals', ['user_id' => $user->id]);
        $this->assertSame(0, $user->fresh()->tokens()->count(), 'Verification sends the user to the login screen.');
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

        $cookie = $login->getCookie('trana_session');
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

    public function test_production_auth_cookie_is_secure(): void
    {
        $account = $this->createVerifiedAccount('Secure Athlete', 'secure@gmail.com');
        $previousEnvironment = app()->environment();
        app()->instance('env', 'production');

        try {
            $response = $this->postJson('/api/auth/login', [
                'identifier' => $account['user']['username'],
                'password' => 'Fixture-password-123',
            ])->assertOk();
            $cookie = $response->getCookie('trana_session');
            $this->assertNotNull($cookie);
            $this->assertTrue($cookie->isSecure());
            $this->assertTrue($cookie->isHttpOnly());
        } finally {
            app()->instance('env', $previousEnvironment);
        }
    }
}
