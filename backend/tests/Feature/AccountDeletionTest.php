<?php

namespace Tests\Feature;

use App\Models\EmailOtpChallenge;
use App\Models\User;
use App\Services\EmailOtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\Support\AuthTestHelpers;
use Tests\Support\EmailOtpTestHelpers;
use Tests\TestCase;

class AccountDeletionTest extends TestCase
{
    use RefreshDatabase;
    use AuthTestHelpers;
    use EmailOtpTestHelpers;

    public function test_deletion_still_requires_a_fresh_email_code_and_exact_delete_confirmation(): void
    {
        $account = $this->createVerifiedAccount('Delete Athlete', 'delete@example.com');
        $user = User::findOrFail($account['user']['id']);
        $token = $account['token'];
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
        $account = $this->createVerifiedAccount('Expiry Athlete', 'expiry@example.com');
        $user = User::findOrFail($account['user']['id']);
        $token = $account['token'];
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
        $account = $this->createVerifiedAccount('Expired Athlete', 'expired@example.com');
        $user = User::findOrFail($account['user']['id']);
        $token = $account['token'];
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
        $account = $this->createVerifiedAccount('No Mail Athlete', 'no-mail@example.com');
        $user = User::findOrFail($account['user']['id']);
        $token = $account['token'];
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
        $account = $this->createVerifiedAccount('Cooldown Athlete', 'cooldown@example.com');
        $user = User::findOrFail($account['user']['id']);
        $token = $account['token'];
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
