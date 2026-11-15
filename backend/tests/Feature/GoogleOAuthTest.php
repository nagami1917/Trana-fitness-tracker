<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\TestCase;

class GoogleOAuthTest extends TestCase
{
    use RefreshDatabase;

    private const STATE_COOKIE = 'trana_google_oauth_state';

    private function configureGoogle(): void
    {
        config([
            'services.google.client_id' => 'trana-web-client.apps.googleusercontent.com',
            'services.google.client_secret' => 'test-google-client-secret',
            'services.google.redirect' => 'https://api.trana.test/api/auth/google/callback',
            'services.google.authorization_url' => 'https://accounts.google.com/o/oauth2/v2/auth',
            'services.google.token_url' => 'https://oauth2.googleapis.com/token',
            'services.google.userinfo_url' => 'https://openidconnect.googleapis.com/v1/userinfo',
            'frontend.url' => 'https://trana.test',
        ]);
    }

    /** @return array{state: string, cookie: string} */
    private function beginGoogleFlow(): array
    {
        $response = $this->get('/api/auth/google/redirect')->assertRedirect();
        $location = (string) $response->headers->get('Location');
        $query = [];
        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);

        $cookie = collect($response->headers->getCookies())->first(
            fn (Cookie $cookie): bool => $cookie->getName() === self::STATE_COOKIE,
        );

        $this->assertSame('https://accounts.google.com/o/oauth2/v2/auth', strtok($location, '?'));
        $this->assertSame('trana-web-client.apps.googleusercontent.com', $query['client_id'] ?? null);
        $this->assertSame('https://api.trana.test/api/auth/google/callback', $query['redirect_uri'] ?? null);
        $this->assertSame('code', $query['response_type'] ?? null);
        $this->assertSame('openid email profile', $query['scope'] ?? null);
        $this->assertSame('S256', $query['code_challenge_method'] ?? null);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $query['code_challenge'] ?? '');
        $this->assertSame('select_account', $query['prompt'] ?? null);
        $this->assertDoesNotMatchRegularExpression('/test-google-client-secret/', $location);
        $this->assertIsString($query['state'] ?? null);
        $this->assertSame(64, strlen($query['state']));
        $this->assertInstanceOf(Cookie::class, $cookie);
        $this->assertSame('/api/auth/google/callback', $cookie->getPath());
        $this->assertTrue($cookie->isHttpOnly());

        $statePayload = json_decode(Crypt::decryptString($cookie->getValue()), true, flags: JSON_THROW_ON_ERROR);
        $this->assertIsArray($statePayload);
        $this->assertSame($query['state'], $statePayload['state'] ?? null);
        $this->assertSame(
            $query['code_challenge'],
            rtrim(strtr(base64_encode(hash('sha256', $statePayload['verifier'], true)), '+/', '-_'), '='),
        );

        return ['state' => $query['state'], 'cookie' => $cookie->getValue()];
    }

    /** @param array<string, mixed> $googleProfile */
    private function fakeGoogleProfile(array $googleProfile): void
    {
        Http::fake([
            'https://oauth2.googleapis.com/token' => Http::response([
                'access_token' => 'test-google-access-token',
                'token_type' => 'Bearer',
                'expires_in' => 3600,
            ]),
            'https://openidconnect.googleapis.com/v1/userinfo' => Http::response($googleProfile),
        ]);
    }

    /** @param array{state: string, cookie: string} $flow */
    private function finishGoogleFlow(array $flow, ?string $state = null)
    {
        return $this->withCookie(self::STATE_COOKIE, $flow['cookie'])
            ->get('/api/auth/google/callback?'.http_build_query([
                'code' => 'test-authorization-code',
                'state' => $state ?? $flow['state'],
            ]));
    }

    private function responseCookie($response, string $name): ?Cookie
    {
        return collect($response->headers->getCookies())
            ->first(fn (Cookie $cookie): bool => $cookie->getName() === $name);
    }

    public function test_google_redirect_uses_state_pkce_and_never_places_client_secret_in_the_url(): void
    {
        $this->configureGoogle();

        $this->beginGoogleFlow();
    }

    public function test_verified_google_identity_creates_a_trana_session_without_an_email_code(): void
    {
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-112233',
            'email' => 'new.athlete@example.com',
            'email_verified' => true,
            'name' => 'New Athlete',
        ]);
        $flow = $this->beginGoogleFlow();

        $response = $this->finishGoogleFlow($flow)->assertRedirect('https://trana.test/');
        $user = User::query()->where('google_sub', 'google-sub-112233')->firstOrFail();

        $this->assertSame('new.athlete@example.com', $user->email);
        $this->assertSame('New Athlete', $user->name);
        $this->assertNotNull($user->email_verified_at);
        $this->assertSame(User::ROLE_ATHLETE, $user->role);
        $this->assertSame(1, $user->tokens()->count());
        $this->assertDatabaseHas('fitness_profiles', ['user_id' => $user->id]);
        $this->assertDatabaseHas('goals', ['user_id' => $user->id]);
        $this->assertDatabaseMissing('email_otp_challenges', ['email' => $user->email]);
        $this->assertArrayNotHasKey('google_sub', $user->toArray());

        $authCookie = $this->responseCookie($response, 'trana_session');
        $csrfCookie = $this->responseCookie($response, 'trana_csrf');
        $this->assertInstanceOf(Cookie::class, $authCookie);
        $this->assertInstanceOf(Cookie::class, $csrfCookie);
        $this->assertTrue($authCookie->isHttpOnly());
        $this->assertTrue($csrfCookie->isHttpOnly());
        $this->assertSame('/api', $authCookie->getPath());
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $csrfCookie->getValue());

        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://oauth2.googleapis.com/token'
                && $request->method() === 'POST'
                && $request['code'] === 'test-authorization-code'
                && is_string($request['code_verifier'] ?? null)
                && strlen($request['code_verifier']) >= 43
                && $request['client_secret'] === 'test-google-client-secret';
        });
        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://openidconnect.googleapis.com/v1/userinfo'
                && $request->hasHeader('Authorization', 'Bearer test-google-access-token');
        });
    }

    public function test_google_can_link_a_matching_password_account_without_replacing_its_password(): void
    {
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-existing',
            'email' => 'legacy.athlete@gmail.com',
            'email_verified' => true,
            'name' => 'Legacy Athlete',
        ]);
        $existing = User::create([
            'name' => 'Legacy Name',
            'username' => 'legacy_athlete',
            'email' => 'legacy.athlete@gmail.com',
            'password' => 'Old-password-123',
        ]);
        $originalPasswordHash = $existing->password;
        $flow = $this->beginGoogleFlow();

        $this->finishGoogleFlow($flow)->assertRedirect('https://trana.test/');
        $linked = $existing->fresh();

        $this->assertSame($existing->id, $linked->id);
        $this->assertSame('google-sub-existing', $linked->google_sub);
        $this->assertNotNull($linked->email_verified_at);
        $this->assertSame('legacy_athlete', $linked->username);
        $this->assertSame($originalPasswordHash, $linked->password);
        $this->assertTrue(Hash::check('Old-password-123', $linked->password));
        $this->assertSame(1, $linked->tokens()->count());
        $this->assertDatabaseMissing('email_otp_challenges', ['email' => $linked->email]);

        $this->postJson('/api/auth/login', [
            'identifier' => 'legacy.athlete@gmail.com',
            'password' => 'Old-password-123',
        ])->assertOk()
            ->assertJsonPath('user.email', 'legacy.athlete@gmail.com')
            ->assertJsonMissingPath('token');
    }

    public function test_unverified_google_email_does_not_create_an_account_or_a_session(): void
    {
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-unverified',
            'email' => 'unverified@example.com',
            'email_verified' => false,
            'name' => 'Unverified Person',
        ]);
        $flow = $this->beginGoogleFlow();

        $response = $this->finishGoogleFlow($flow)
            ->assertRedirect('https://trana.test/login?google=unverified_email');

        $this->assertSame(0, User::query()->count());
        $this->assertDatabaseCount('personal_access_tokens', 0);
        $this->assertNull($this->responseCookie($response, 'trana_session'));
    }

    public function test_account_with_a_different_google_identity_is_not_merged(): void
    {
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-new',
            'email' => 'linked.athlete@gmail.com',
            'email_verified' => true,
            'name' => 'Linked Athlete',
        ]);
        $existing = User::create([
            'name' => 'Linked Athlete',
            'username' => 'linked_athlete',
            'email' => 'linked.athlete@gmail.com',
            'password' => 'Old-password-123',
        ]);
        $existing->forceFill(['google_sub' => 'google-sub-already-linked'])->save();
        $flow = $this->beginGoogleFlow();

        $response = $this->finishGoogleFlow($flow)
            ->assertRedirect('https://trana.test/login?google=failed');

        $this->assertSame('google-sub-already-linked', $existing->fresh()->google_sub);
        $this->assertSame(0, $existing->fresh()->tokens()->count());
        $this->assertNull($this->responseCookie($response, 'trana_session'));
    }

    public function test_suspended_google_account_does_not_receive_a_session(): void
    {
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-suspended',
            'email' => 'suspended.athlete@gmail.com',
            'email_verified' => true,
            'name' => 'Suspended Athlete',
        ]);
        $suspended = User::create([
            'name' => 'Suspended Athlete',
            'username' => 'suspended_athlete',
            'email' => 'suspended.athlete@gmail.com',
            'password' => 'Old-password-123',
        ]);
        $suspended->forceFill([
            'google_sub' => 'google-sub-suspended',
            'email_verified_at' => now(),
            'suspended_at' => now(),
        ])->save();
        $flow = $this->beginGoogleFlow();

        $response = $this->finishGoogleFlow($flow)
            ->assertRedirect('https://trana.test/login?google=account_unavailable');

        $this->assertSame(0, $suspended->fresh()->tokens()->count());
        $this->assertNull($this->responseCookie($response, 'trana_session'));
    }

    public function test_invalid_or_mismatched_state_stops_before_contacting_google(): void
    {
        $this->configureGoogle();
        Http::fake();
        $flow = $this->beginGoogleFlow();

        $this->finishGoogleFlow($flow, 'attacker-controlled-state')
            ->assertRedirect('https://trana.test/login?google=failed');

        Http::assertNothingSent();
        $this->assertSame(0, User::query()->count());
    }

    public function test_missing_google_credentials_leave_the_password_flow_available(): void
    {
        config([
            'services.google.client_id' => null,
            'services.google.client_secret' => null,
            'services.google.redirect' => null,
            'frontend.url' => 'https://trana.test',
        ]);

        $response = $this->get('/api/auth/google/redirect')
            ->assertRedirect('https://trana.test/login?google=not_configured');

        $this->assertNull($this->responseCookie($response, self::STATE_COOKIE));
    }
}
