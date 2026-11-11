<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class PasswordRecoveryTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(string $email = 'athlete@example.com'): User
    {
        return User::create([
            'name' => 'Test Athlete',
            'email' => $email,
            'password' => bcrypt('original-password-1'),
        ]);
    }

    public function test_forgot_password_answers_generically_for_any_email(): void
    {
        $this->makeUser();

        $this->postJson('/api/password/forgot', ['email' => 'athlete@example.com'])
            ->assertStatus(202)
            ->assertJsonStructure(['message']);

        // Unknown addresses answer identically — no account enumeration.
        $this->postJson('/api/password/forgot', ['email' => 'nobody@example.com'])
            ->assertStatus(202)
            ->assertJsonStructure(['message']);
    }

    public function test_reset_password_with_valid_token_updates_credentials_and_revokes_tokens(): void
    {
        $user = $this->makeUser();
        $user->createToken('stale-device');
        $token = Password::broker()->createToken($user);

        $this->postJson('/api/password/reset', [
            'token' => $token,
            'email' => $user->email,
            'password' => 'brand-new-password-9',
            'password_confirmation' => 'brand-new-password-9',
        ])->assertOk()->assertJsonStructure(['message']);

        $fresh = $user->fresh();
        $this->assertTrue(\Illuminate\Support\Facades\Hash::check('brand-new-password-9', $fresh->password));
        $this->assertSame(0, $fresh->tokens()->count(), 'All existing tokens must be revoked after a reset');

        // The new password signs in; the old one does not.
        $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'brand-new-password-9',
        ])->assertOk()->assertJsonStructure(['token', 'user']);

        $this->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'original-password-1',
        ])->assertStatus(422);
    }

    public function test_reset_password_rejects_invalid_token(): void
    {
        $user = $this->makeUser();

        $this->postJson('/api/password/reset', [
            'token' => 'not-a-real-token',
            'email' => $user->email,
            'password' => 'brand-new-password-9',
            'password_confirmation' => 'brand-new-password-9',
        ])->assertStatus(422);
    }

    public function test_signed_verification_link_marks_email_verified_and_redirects_to_spa(): void
    {
        $user = $this->makeUser('unverified@example.com');
        $this->assertNull($user->email_verified_at);

        $url = URL::temporarySignedRoute('verification.verify', now()->addMinutes(10), [
            'id' => $user->id,
            'hash' => sha1($user->email),
        ]);

        $response = $this->get($url);

        $response->assertRedirect();
        $this->assertStringContainsString('/verify-email?status=verified', $response->headers->get('Location'));
        $this->assertNotNull($user->fresh()->email_verified_at, 'Signed link must mark the address verified');
    }

    public function test_tampered_verification_link_is_rejected(): void
    {
        $user = $this->makeUser('tamper@example.com');

        // Same shape, no valid signature.
        $response = $this->get('/api/email/verify/'.$user->id.'/'.sha1($user->email));

        $response->assertRedirect();
        $this->assertStringContainsString('/verify-email?status=invalid', $response->headers->get('Location'));
        $this->assertNull($user->fresh()->email_verified_at, 'Unsigned request must never verify an address');
    }
}
