<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\Support\GoogleAuthTestHelpers;
use Tests\TestCase;

class GoogleAuthTest extends TestCase
{
    use RefreshDatabase;
    use GoogleAuthTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepareGoogleAuth();
    }

    public function test_google_oidc_creates_a_passwordless_account_and_rejects_nonce_replay(): void
    {
        $nonce = $this->requestGoogleNonce();
        $credential = $this->googleCredential($nonce, [
            'sub' => 'google-sub-new-athlete',
            'email' => 'New.Athlete@Example.com',
            'name' => 'New Google Athlete',
        ]);

        $response = $this->postJson('/api/auth/google', ['credential' => $credential])
            ->assertOk()
            ->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'email_verified_at', 'profile']]);

        $user = User::query()->where('google_sub', 'google-sub-new-athlete')->firstOrFail();
        $this->assertSame('new.athlete@example.com', $user->email);
        $this->assertSame('New Google Athlete', $user->name);
        $this->assertNull($user->password, 'Google auth must not create a TRANA password.');
        $this->assertNotNull($user->email_verified_at);
        $this->assertDatabaseHas('fitness_profiles', ['user_id' => $user->id]);
        $this->assertDatabaseHas('goals', ['user_id' => $user->id]);
        $this->assertSame($user->id, $response->json('user.id'));
        $this->assertNotEmpty($response->json('token'));

        $this->postJson('/api/auth/google', ['credential' => $credential])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['credential']);
        $this->assertSame(1, User::query()->count());
        $this->assertSame(1, $user->fresh()->tokens()->count());
    }

    public function test_verified_google_email_links_a_legacy_trana_account_without_overwriting_its_name(): void
    {
        $legacy = User::create([
            'name' => 'Athlete Chosen Name',
            'email' => 'LEGACY@EXAMPLE.COM',
            'password' => null,
        ]);
        $legacy->forceFill(['email_verified_at' => null])->save();

        $response = $this->signInWithGoogle([
            'sub' => 'google-sub-legacy-link',
            'email' => 'legacy@example.com',
            'name' => 'Google Profile Name',
        ]);

        $this->assertSame(1, User::query()->count());
        $this->assertSame($legacy->id, $response['user']['id']);
        $this->assertDatabaseHas('users', [
            'id' => $legacy->id,
            'email' => 'legacy@example.com',
            'google_sub' => 'google-sub-legacy-link',
            'name' => 'Athlete Chosen Name',
        ]);
        $this->assertNotNull($legacy->fresh()->email_verified_at);
    }

    public function test_google_sign_in_supports_verified_workspace_email_addresses(): void
    {
        $response = $this->signInWithGoogle([
            'sub' => 'google-workspace-sub',
            'email' => 'runner@club.example.org',
            'name' => 'Workspace Athlete',
        ]);

        $this->assertSame('runner@club.example.org', $response['user']['email']);
        $this->assertDatabaseHas('users', [
            'google_sub' => 'google-workspace-sub',
            'email' => 'runner@club.example.org',
        ]);
    }

    public function test_a_different_google_subject_cannot_take_over_an_account_with_the_same_email(): void
    {
        $this->signInWithGoogle([
            'sub' => 'first-google-sub',
            'email' => 'same@example.com',
        ]);
        $nonce = $this->requestGoogleNonce();

        $this->postJson('/api/auth/google', [
            'credential' => $this->googleCredential($nonce, [
                'sub' => 'second-google-sub',
                'email' => 'same@example.com',
            ]),
        ])->assertUnprocessable()->assertJsonValidationErrors(['credential']);

        $this->assertSame(1, User::query()->count());
        $this->assertDatabaseMissing('users', ['google_sub' => 'second-google-sub']);
    }

    public function test_suspended_google_accounts_are_not_issued_tokens(): void
    {
        $user = User::create([
            'name' => 'Suspended Athlete',
            'email' => 'suspended@example.com',
            'google_sub' => 'google-suspended-sub',
            'password' => null,
            'suspended_at' => now(),
        ]);

        $this->postJson('/api/auth/google', [
            'credential' => $this->googleCredential(
                $this->requestGoogleNonce(),
                ['sub' => 'google-suspended-sub', 'email' => $user->email],
            ),
        ])->assertForbidden()->assertJsonPath('message', 'This account has been suspended.');

        $this->assertSame(0, $user->fresh()->tokens()->count());
    }

    public function test_invalid_audience_issuer_expiration_and_unverified_email_are_rejected(): void
    {
        $invalidClaims = [
            ['aud' => 'another-client-id'],
            ['iss' => 'https://accounts.google.evil.test'],
            ['exp' => time() - 1],
            ['email_verified' => false],
            ['nonce' => 'not-issued-by-trana'],
        ];

        foreach ($invalidClaims as $overrides) {
            $nonce = $this->requestGoogleNonce();
            $this->postJson('/api/auth/google', [
                'credential' => $this->googleCredential($nonce, $overrides),
            ])->assertUnprocessable()->assertJsonValidationErrors(['credential']);
        }

        $this->assertSame(0, User::query()->count());
    }

    public function test_invalid_signature_and_non_rs256_tokens_are_rejected(): void
    {
        $nonce = $this->requestGoogleNonce();
        $credential = $this->googleCredential($nonce);
        $parts = explode('.', $credential);
        $parts[2] = rtrim(strtr(base64_encode(random_bytes(256)), '+/', '-_'), '=');

        $this->postJson('/api/auth/google', ['credential' => implode('.', $parts)])
            ->assertUnprocessable()->assertJsonValidationErrors(['credential']);

        $nonce = $this->requestGoogleNonce();
        $credential = $this->googleCredential($nonce);
        $parts = explode('.', $credential);
        $header = json_decode(base64_decode(strtr($parts[0], '-_', '+/')), true, flags: JSON_THROW_ON_ERROR);
        $header['alg'] = 'none';
        $parts[0] = rtrim(strtr(base64_encode(json_encode($header, JSON_THROW_ON_ERROR)), '+/', '-_'), '=');

        $this->postJson('/api/auth/google', ['credential' => implode('.', $parts)])
            ->assertUnprocessable()->assertJsonValidationErrors(['credential']);
        $this->assertSame(0, User::query()->count());
    }

    public function test_google_auth_rejects_passwords_and_the_old_email_code_endpoints_are_gone(): void
    {
        $nonce = $this->requestGoogleNonce();
        $this->postJson('/api/auth/google', [
            'credential' => $this->googleCredential($nonce),
            'password' => 'must-not-be-collected',
        ])->assertUnprocessable()->assertJsonValidationErrors(['password']);

        $this->postJson('/api/auth/register', [])->assertNotFound();
        $this->postJson('/api/auth/login', [])->assertNotFound();
        $this->postJson('/api/auth/otp/verify', [])->assertNotFound();
        $this->assertSame(0, User::query()->count());
    }

    public function test_google_nonce_endpoint_requires_the_server_client_id(): void
    {
        config(['services.google.client_id' => '']);
        Cache::forget('google.oauth.signing-keys');

        $this->postJson('/api/auth/google/nonce')
            ->assertStatus(503)
            ->assertJsonPath('message', 'Google sign-in is not configured for this deployment.');
    }
}
