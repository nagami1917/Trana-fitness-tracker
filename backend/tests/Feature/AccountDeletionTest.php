<?php

namespace Tests\Feature;

use App\Models\EmailOtpChallenge;
use App\Models\User;
use App\Services\EmailOtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\Support\EmailOtpTestHelpers;
use Tests\TestCase;

class AccountDeletionTest extends TestCase
{
    use RefreshDatabase;
    use EmailOtpTestHelpers;

    public function test_deletion_still_requires_a_fresh_email_code_and_exact_delete_confirmation(): void
    {
        $user = User::create([
            'name' => 'Delete Athlete',
            'email' => 'delete@example.com',
            'google_sub' => 'google-delete-sub',
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
        $code = $this->sentOtpCodeFor($user->email);

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

    public function test_deletion_code_expires_and_allows_only_five_failed_attempts(): void
    {
        $user = User::create([
            'name' => 'Expiry Athlete',
            'email' => 'expiry@example.com',
            'password' => null,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();
        $token = $user->createToken('test')->plainTextToken;
        $headers = ['Authorization' => 'Bearer '.$token];
        Notification::fake();

        $this->postJson('/api/account/delete-code', [], $headers)->assertAccepted();
        $wrongCode = '000000';
        $actualCode = $this->sentOtpCodeFor($user->email);
        if ($actualCode === $wrongCode) {
            $wrongCode = '000001';
        }

        for ($attempt = 0; $attempt < EmailOtpService::MAX_ATTEMPTS; $attempt++) {
            $this->deleteJson('/api/account', [
                'code' => $wrongCode,
                'confirmation' => 'DELETE',
            ], $headers)->assertUnprocessable()->assertJsonValidationErrors(['code']);
        }

        $this->assertDatabaseHas('email_otp_challenges', [
            'email' => $user->email,
            'attempts' => EmailOtpService::MAX_ATTEMPTS,
        ]);
        $this->deleteJson('/api/account', [
            'code' => $actualCode,
            'confirmation' => 'DELETE',
        ], $headers)->assertUnprocessable();
        $this->assertDatabaseHas('users', ['id' => $user->id]);
    }

    public function test_expired_deletion_code_cannot_delete_an_account(): void
    {
        $user = User::create([
            'name' => 'Expired Athlete',
            'email' => 'expired@example.com',
            'password' => null,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();
        $token = $user->createToken('test')->plainTextToken;
        $headers = ['Authorization' => 'Bearer '.$token];
        Notification::fake();

        $this->postJson('/api/account/delete-code', [], $headers)->assertAccepted();
        $code = $this->sentOtpCodeFor($user->email);
        $this->travel(11)->minutes();

        $this->deleteJson('/api/account', [
            'code' => $code,
            'confirmation' => 'DELETE',
        ], $headers)->assertUnprocessable()->assertJsonValidationErrors(['code']);
        $this->assertDatabaseHas('users', ['id' => $user->id]);
    }

    public function test_production_does_not_claim_a_log_mailer_delivered_a_deletion_code(): void
    {
        $user = User::create([
            'name' => 'No Mail Athlete',
            'email' => 'no-mail@example.com',
            'password' => null,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();
        $token = $user->createToken('test')->plainTextToken;
        $previousEnvironment = app()->environment();
        app()->instance('env', 'production');
        config(['mail.default' => 'log']);

        try {
            $this->postJson('/api/account/delete-code', [], [
                'Authorization' => 'Bearer '.$token,
            ])->assertStatus(503);
            $this->assertDatabaseMissing('email_otp_challenges', ['email' => $user->email]);
        } finally {
            app()->instance('env', $previousEnvironment);
        }
    }

    public function test_active_deletion_code_is_cooldown_limited(): void
    {
        $user = User::create([
            'name' => 'Cooldown Athlete',
            'email' => 'cooldown@example.com',
            'password' => null,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();
        $token = $user->createToken('test')->plainTextToken;
        $headers = ['Authorization' => 'Bearer '.$token];
        Notification::fake();

        $this->postJson('/api/account/delete-code', [], $headers)->assertAccepted();
        $this->postJson('/api/account/delete-code', [], $headers)->assertStatus(429);
        $this->assertSame(1, (int) EmailOtpChallenge::query()->where('email', $user->email)->value('send_count'));

        $this->travel(61)->seconds();
        $this->postJson('/api/account/delete-code', [], $headers)->assertAccepted();
        $this->assertSame(2, (int) EmailOtpChallenge::query()->where('email', $user->email)->value('send_count'));
    }
}
