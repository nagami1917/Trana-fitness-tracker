<?php

namespace Tests\Feature;

use App\Models\EmailOtpChallenge;
use App\Models\User;
use App\Notifications\EmailOtpNotification;
use App\Services\EmailOtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\Support\EmailOtpTestHelpers;
use Tests\TestCase;

class EmailOtpAuthTest extends TestCase
{
    use RefreshDatabase;
    use EmailOtpTestHelpers;

    public function test_registration_is_completed_only_after_a_six_digit_code_is_verified(): void
    {
        Notification::fake();

        $this->postJson('/api/auth/register', [
            'name' => 'OTP Athlete',
            'email' => 'otp.athlete@gmail.com',
        ])->assertAccepted()->assertJsonStructure(['message']);

        $this->assertDatabaseCount('users', 0);
        $code = $this->sentOtpCodeFor('otp.athlete@gmail.com');
        $this->assertMatchesRegularExpression('/^[0-9]{6}$/', $code);

        $challenge = EmailOtpChallenge::query()->where('email', 'otp.athlete@gmail.com')->firstOrFail();
        $this->assertSame('registration', $challenge->purpose);
        $this->assertNotSame($code, $challenge->code_hash, 'Only a keyed hash of the code may be stored.');
        $this->assertSame(0, (int) $challenge->attempts);

        $response = $this->postJson('/api/auth/otp/verify', [
            'email' => 'otp.athlete@gmail.com',
            'code' => $code,
        ])->assertOk()->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'email_verified_at']]);

        $user = User::where('email', 'otp.athlete@gmail.com')->firstOrFail();
        $this->assertSame('OTP Athlete', $user->name);
        $this->assertNull($user->password, 'TRANA must not create or store a user password.');
        $this->assertNotNull($user->email_verified_at);
        $this->assertDatabaseHas('fitness_profiles', ['user_id' => $user->id]);
        $this->assertDatabaseHas('goals', ['user_id' => $user->id]);
        $this->assertDatabaseHas('email_otp_challenges', [
            'email' => $user->email,
            'attempts' => EmailOtpService::MAX_ATTEMPTS,
        ]);

        // Codes are one-time, even when the same request is replayed.
        $this->postJson('/api/auth/otp/verify', [
            'email' => $user->email,
            'code' => $code,
        ])->assertUnprocessable();

        $this->assertSame($user->id, $response->json('user.id'));
    }

    public function test_password_fields_are_not_accepted_by_auth_endpoints(): void
    {
        $this->postJson('/api/auth/register', [
            'name' => 'No Password Athlete',
            'email' => 'no-password@gmail.com',
            'password' => 'not-collected',
        ])->assertUnprocessable()->assertJsonValidationErrors(['password']);

        User::create([
            'name' => 'Existing Athlete',
            'email' => 'existing@gmail.com',
            'password' => null,
        ]);

        $this->postJson('/api/auth/login', [
            'email' => 'existing@gmail.com',
            'password' => 'not-collected',
        ])->assertUnprocessable()->assertJsonValidationErrors(['password']);

        $this->postJson('/api/auth/otp/verify', [
            'email' => 'existing@gmail.com',
            'code' => '012345',
            'password' => 'not-collected',
        ])->assertUnprocessable()->assertJsonValidationErrors(['password']);

        $this->assertDatabaseCount('email_otp_challenges', 0);
        $this->assertDatabaseMissing('users', ['email' => 'no-password@gmail.com']);
    }

    public function test_existing_account_can_sign_in_without_a_password_and_otp_verifies_email(): void
    {
        $user = User::create([
            'name' => 'Legacy Athlete',
            'email' => 'legacy@example.com',
            'password' => 'old-trana-password-123',
        ]);
        $user->forceFill(['email_verified_at' => null])->save();
        Notification::fake();

        $requested = $this->postJson('/api/auth/login', [
            'email' => 'LEGACY@EXAMPLE.COM',
        ])->assertAccepted()->assertJsonStructure(['message']);
        $this->assertArrayNotHasKey('token', $requested->json());
        $code = $this->sentOtpCodeFor('legacy@example.com');
        $this->assertMatchesRegularExpression('/^[0-9]{6}$/', $code);

        $verified = $this->postJson('/api/auth/otp/verify', [
            'email' => 'legacy@example.com',
            'code' => $code,
        ])->assertOk()->assertJsonPath('user.id', $user->id);

        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->assertSame(1, $user->fresh()->tokens()->count());
        $this->assertNotEmpty($verified->json('token'));
    }

    public function test_login_response_does_not_reveal_whether_an_account_exists(): void
    {
        User::create([
            'name' => 'Known Athlete',
            'email' => 'known@gmail.com',
            'password' => null,
        ]);
        Notification::fake();

        $known = $this->postJson('/api/auth/login', ['email' => 'known@gmail.com'])->assertAccepted();
        $unknown = $this->postJson('/api/auth/login', ['email' => 'unknown@gmail.com'])->assertAccepted();

        $this->assertSame($known->json('message'), $unknown->json('message'));
        $this->assertDatabaseHas('email_otp_challenges', ['email' => 'known@gmail.com']);
        $this->assertDatabaseMissing('email_otp_challenges', ['email' => 'unknown@gmail.com']);
        $this->assertDatabaseMissing('users', ['email' => 'unknown@gmail.com']);
    }

    public function test_wrong_codes_are_limited_to_five_attempts(): void
    {
        User::create([
            'name' => 'Attempt Athlete',
            'email' => 'attempt@gmail.com',
            'password' => null,
        ]);
        Notification::fake();
        $this->postJson('/api/auth/login', ['email' => 'attempt@gmail.com'])->assertAccepted();
        $code = $this->sentOtpCodeFor('attempt@gmail.com');
        $wrongCode = $code === '000000' ? '000001' : '000000';

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/auth/otp/verify', [
                'email' => 'attempt@gmail.com',
                'code' => $wrongCode,
            ])->assertUnprocessable();
        }

        $this->assertDatabaseHas('email_otp_challenges', [
            'email' => 'attempt@gmail.com',
            'attempts' => EmailOtpService::MAX_ATTEMPTS,
        ]);
        $this->postJson('/api/auth/otp/verify', [
            'email' => 'attempt@gmail.com',
            'code' => $code,
        ])->assertUnprocessable();
    }

    public function test_expired_code_cannot_be_used(): void
    {
        Notification::fake();
        $this->postJson('/api/auth/register', [
            'name' => 'Expired Athlete',
            'email' => 'expired@gmail.com',
        ])->assertAccepted();
        $code = $this->sentOtpCodeFor('expired@gmail.com');

        $this->travel(11)->minutes();
        $this->postJson('/api/auth/otp/verify', [
            'email' => 'expired@gmail.com',
            'code' => $code,
        ])->assertUnprocessable();

        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseHas('email_otp_challenges', [
            'email' => 'expired@gmail.com',
            'attempts' => EmailOtpService::MAX_ATTEMPTS,
        ]);
    }

    public function test_successfully_used_code_keeps_the_hourly_counter_and_active_codes_keep_the_cooldown(): void
    {
        $user = User::create([
            'name' => 'Cooldown Athlete',
            'email' => 'cooldown@gmail.com',
            'password' => null,
        ]);
        Notification::fake();

        $this->postJson('/api/auth/login', ['email' => $user->email])->assertAccepted();
        $code = $this->sentOtpCodeFor($user->email);
        $this->postJson('/api/auth/otp/verify', ['email' => $user->email, 'code' => $code])->assertOk();

        $challenge = EmailOtpChallenge::query()->where('email', $user->email)->firstOrFail();
        $this->assertSame(1, (int) $challenge->send_count);
        $this->assertSame(EmailOtpService::MAX_ATTEMPTS, (int) $challenge->attempts);

        // A code already consumed is not an active resend, so an immediate
        // fresh sign-in challenge is allowed while the hourly counter persists.
        $this->postJson('/api/auth/login', ['email' => $user->email])->assertAccepted();
        $this->assertSame(2, (int) $challenge->fresh()->send_count);

        // Re-sending the active code is still delayed by 60 seconds.
        $this->postJson('/api/auth/login', ['email' => $user->email])->assertAccepted();
        $this->assertSame(2, (int) $challenge->fresh()->send_count);

        $this->travel(61)->seconds();
        $this->postJson('/api/auth/login', ['email' => $user->email])->assertAccepted();
        $this->assertSame(3, (int) $challenge->fresh()->send_count);
    }

    public function test_five_send_hourly_limit_survives_consumed_challenges(): void
    {
        Notification::fake();
        $service = app(EmailOtpService::class);
        $email = 'hourly-limit@gmail.com';

        for ($send = 1; $send <= EmailOtpService::MAX_SENDS_PER_HOUR; $send++) {
            if ($send > 1) {
                $this->travel(61)->seconds();
            }

            $this->assertTrue($service->issue($email, 'Rate Limit Athlete', EmailOtpService::PURPOSE_LOGIN));
            $challenge = EmailOtpChallenge::query()->where('email', $email)->firstOrFail();
            $this->assertSame($send, (int) $challenge->send_count);
            $challenge->forceFill([
                'attempts' => EmailOtpService::MAX_ATTEMPTS,
                'expires_at' => now()->subSecond(),
            ])->save();
        }

        $this->travel(61)->seconds();
        $this->assertFalse($service->issue($email, 'Rate Limit Athlete', EmailOtpService::PURPOSE_LOGIN));
        $this->assertSame(EmailOtpService::MAX_SENDS_PER_HOUR, (int) $challenge->fresh()->send_count);
    }

    public function test_switching_otp_purpose_replaces_the_challenge_but_keeps_hourly_rate_state(): void
    {
        Notification::fake();
        $service = app(EmailOtpService::class);
        $email = 'purpose-switch@gmail.com';

        $this->assertTrue($service->issue($email, 'Purpose Athlete', EmailOtpService::PURPOSE_LOGIN));
        $this->assertTrue($service->issue($email, 'Purpose Athlete', EmailOtpService::PURPOSE_ACCOUNT_DELETION));

        $challenge = EmailOtpChallenge::query()->where('email', $email)->firstOrFail();
        $this->assertSame(EmailOtpService::PURPOSE_ACCOUNT_DELETION, $challenge->purpose);
        $this->assertSame(2, (int) $challenge->send_count);
    }

    public function test_registration_resend_is_throttled_per_email(): void
    {
        Notification::fake();
        $payload = ['name' => 'Rate Limited Athlete', 'email' => 'cooldown@gmail.com'];

        $this->postJson('/api/auth/register', $payload)->assertAccepted();
        $this->postJson('/api/auth/register', $payload)->assertStatus(429);
    }

    public function test_production_refuses_to_claim_that_log_mail_was_delivered(): void
    {
        $previousEnvironment = app()->environment();
        app()->instance('env', 'production');
        config(['mail.default' => 'log']);

        try {
            $this->postJson('/api/auth/register', [
                'name' => 'No Mail Athlete',
                'email' => 'no-mail@gmail.com',
            ])->assertStatus(503)->assertJsonPath('message', 'The email service could not send your code. Please try again later or contact support.');

            $this->assertDatabaseMissing('email_otp_challenges', ['email' => 'no-mail@gmail.com']);
        } finally {
            app()->instance('env', $previousEnvironment);
        }
    }

    public function test_old_unverified_bearer_tokens_are_revoked_and_must_be_replaced_by_otp(): void
    {
        $user = User::create([
            'name' => 'Unverified Legacy Athlete',
            'email' => 'unverified-legacy@gmail.com',
            'password' => 'old-trana-password-123',
        ]);
        $token = $user->createToken('legacy-device')->plainTextToken;

        $this->getJson('/api/auth/me', ['Authorization' => 'Bearer '.$token])
            ->assertUnauthorized()
            ->assertJsonPath('message', 'Confirm your email with a sign-in code before continuing.');

        $this->assertSame(0, $user->fresh()->tokens()->count());
    }

    public function test_account_deletion_requires_a_separate_email_code_and_confirmation(): void
    {
        $user = User::create([
            'name' => 'Delete Athlete',
            'email' => 'delete@gmail.com',
            'password' => null,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();
        $token = $user->createToken('test')->plainTextToken;
        $headers = ['Authorization' => 'Bearer '.$token];
        Notification::fake();

        $this->deleteJson('/api/account', [
            'confirmation' => 'DELETE',
            'password' => 'not-collected',
        ], $headers)->assertUnprocessable()->assertJsonValidationErrors(['code', 'password']);
        $this->assertDatabaseHas('users', ['id' => $user->id]);

        $this->postJson('/api/account/delete-code', ['password' => 'not-collected'], $headers)
            ->assertUnprocessable()->assertJsonValidationErrors(['password']);
        $this->assertDatabaseMissing('email_otp_challenges', ['email' => $user->email]);

        $this->postJson('/api/account/delete-code', [], $headers)->assertAccepted();
        $code = $this->sentOtpCodeFor('delete@gmail.com');

        $this->deleteJson('/api/account', [
            'code' => $code,
            'confirmation' => 'delete',
        ], $headers)->assertUnprocessable()->assertJsonValidationErrors(['confirmation']);
        $this->assertDatabaseHas('users', ['id' => $user->id]);

        $this->deleteJson('/api/account', [
            'code' => $code,
            'confirmation' => 'DELETE',
        ], $headers)->assertOk();

        $this->assertDatabaseMissing('users', ['id' => $user->id]);
        $this->assertDatabaseMissing('personal_access_tokens', ['tokenable_id' => $user->id]);
        $this->assertDatabaseMissing('email_otp_challenges', ['email' => $user->email]);
    }
}
