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
    private function beginGoogleFlow(?string $intent = null): array
    {
        $url = '/api/auth/google/redirect';
        if ($intent !== null) {
            $url .= '?'.http_build_query(['intent' => $intent]);
        }
        $response = $this->get($url)->assertRedirect();
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

        // The state is self-contained and signed: v1.<payload>.<hmac>. No
        // cookie is set, so a second tab or a retry cannot invalidate it.
        $this->assertNull($cookie, 'the OAuth state must not depend on a cookie');
        $statePayload = $this->decodeState($query['state']);
        $this->assertSame($intent ?? 'login', $statePayload['i'] ?? null);
        $this->assertSame(
            $query['code_challenge'],
            rtrim(strtr(base64_encode(hash('sha256', $statePayload['v'], true)), '+/', '-_'), '='),
        );

        return ['state' => $query['state']];
    }

    /** @return array<string, mixed> Verified state payload, or fails the test. */
    private function decodeState(string $state): array
    {
        $parts = explode('.', $state);
        $this->assertCount(3, $parts, 'state must be v1.<payload>.<mac>');
        [$version, $encoded, $mac] = $parts;
        $this->assertSame('v1', $version);

        $key = hash_hmac('sha256', 'trana-google-oauth-state', (string) config('app.key'), true);
        $this->assertSame(hash_hmac('sha256', $version.'.'.$encoded, $key), $mac, 'state MAC must verify');

        return json_decode(base64_decode(strtr($encoded, '-_', '+/')), true, flags: JSON_THROW_ON_ERROR);
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

    /** @param array{state: string} $flow */
    private function finishGoogleFlow(array $flow, ?string $state = null)
    {
        return $this->get('/api/auth/google/callback?'.http_build_query([
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
        $flow = $this->beginGoogleFlow('signup');

        $response = $this->finishGoogleFlow($flow);
        Http::assertSentCount(2);
        $response->assertRedirect('https://trana.test/');
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

    public function test_google_login_does_not_create_a_trana_account_when_google_email_is_unknown(): void
    {
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-login-only',
            'email' => 'new.login@example.com',
            'email_verified' => true,
            'name' => 'New Login',
        ]);
        $flow = $this->beginGoogleFlow('login');

        $response = $this->finishGoogleFlow($flow)
            ->assertRedirect('https://trana.test/login?google=account_not_found');

        $this->assertSame(0, User::query()->count());
        $this->assertDatabaseCount('personal_access_tokens', 0);
        $this->assertNull($this->responseCookie($response, 'trana_session'));
        $this->assertNull($this->responseCookie($response, 'trana_csrf'));
    }

    public function test_google_login_reuses_the_account_created_by_google_signup(): void
    {
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-reused',
            'email' => 'repeat.athlete@example.com',
            'email_verified' => true,
            'name' => 'Repeat Athlete',
        ]);

        $signupFlow = $this->beginGoogleFlow('signup');
        $this->finishGoogleFlow($signupFlow)->assertRedirect('https://trana.test/');
        $created = User::query()->where('google_sub', 'google-sub-reused')->firstOrFail();

        $loginFlow = $this->beginGoogleFlow('login');
        $loginResponse = $this->finishGoogleFlow($loginFlow)->assertRedirect('https://trana.test/');

        $this->assertSame(1, User::query()->count());
        $this->assertSame($created->id, User::query()->where('google_sub', 'google-sub-reused')->value('id'));
        $this->assertInstanceOf(Cookie::class, $this->responseCookie($loginResponse, 'trana_session'));
    }

    public function test_signing_up_with_an_existing_google_account_says_it_already_exists(): void
    {
        // Signing up twice is a normal mistake, not a fault. It must not read
        // as the generic "could not be completed", because that leaves the
        // athlete guessing whether their account exists at all.
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-already-there',
            'email' => 'already.there@example.com',
            'email_verified' => true,
            'name' => 'Already There',
        ]);

        // The case that actually confuses people: an account created with a
        // password earlier, then "Create account" via Google with the same
        // address. The account exists; the button was just the wrong one.
        User::create([
            'name' => 'Already There',
            'username' => 'already_there',
            'email' => 'already.there@example.com',
            'password' => 'Old-password-123',
        ]);

        $this->finishGoogleFlow($this->beginGoogleFlow('signup'))
            ->assertRedirect('https://trana.test/login?google=account_exists');

        $this->assertSame(1, User::query()->count(), 'a duplicate signup must not create a second account');
        $this->assertNull(
            User::query()->where('email', 'already.there@example.com')->value('google_sub'),
            'reporting the conflict must not link or create anything',
        );
    }

    public function test_logging_in_with_an_unknown_google_account_still_says_not_found(): void
    {
        // The mirror image: login intent must never silently create anything.
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-stranger',
            'email' => 'stranger@example.com',
            'email_verified' => true,
            'name' => 'Stranger',
        ]);

        $this->finishGoogleFlow($this->beginGoogleFlow('login'))
            ->assertRedirect('https://trana.test/login?google=account_not_found');

        $this->assertSame(0, User::query()->count());
    }

    public function test_a_rejected_state_reports_an_expired_session_not_a_generic_failure(): void
    {
        $this->configureGoogle();
        Http::fake();

        $this->get('/api/auth/google/callback?code=abc&state=v1.bogus.mac')
            ->assertRedirect('https://trana.test/login?google=session_expired');

        // The browser gets a short stable code; the reason stays in the log.
        $logged = DB::table('error_logs')->pluck('route')->implode(' ');
        $this->assertStringContainsString('oauth:state_invalid(mac)', $logged);
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

        // A conflict is not a state problem: the round trip was fine, the
        // identities just disagree. Saying so is the whole point.
        $response = $this->finishGoogleFlow($flow)
            ->assertRedirect('https://trana.test/login?google=identity_conflict');

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
            ->assertRedirect('https://trana.test/login?google=session_expired');

        Http::assertNothingSent();
        $this->assertSame(0, User::query()->count());
    }

    public function test_a_rejected_state_is_persisted_so_the_failure_is_diagnosable(): void
    {
        // Vercel's request logs are ephemeral, so a bare Log::warning leaves no
        // evidence: a broken OAuth round trip used to be completely silent.
        $this->configureGoogle();
        Http::fake();
        $flow = $this->beginGoogleFlow();

        $this->finishGoogleFlow($flow, 'attacker-controlled-state')
            ->assertRedirect('https://trana.test/login?google=session_expired');

        $log = \App\Models\ErrorLog::query()->where('route', 'oauth:state_invalid')->first();
        $this->assertNotNull($log, 'a rejected OAuth state must be recorded');
        $this->assertSame('api', $log->kind);
        $this->assertSame('error', $log->level);

        // Repeats group onto one row rather than flooding the table.
        $this->finishGoogleFlow($flow, 'attacker-controlled-state')
            ->assertRedirect('https://trana.test/login?google=session_expired');
        $this->assertSame(1, \App\Models\ErrorLog::query()->where('route', 'oauth:state_invalid')->count());
    }

    public function test_a_missing_state_is_distinguished_from_an_invalid_one(): void
    {
        // "Google sent us nothing" and "what it sent does not verify" produce
        // the same user-visible message but need completely different fixes.
        $this->configureGoogle();
        Http::fake();

        $this->get('/api/auth/google/callback?code=abc')
            ->assertRedirect('https://trana.test/login?google=session_expired');

        $this->assertDatabaseHas('error_logs', ['route' => 'oauth:state_missing']);
        $this->assertDatabaseMissing('error_logs', ['route' => 'oauth:state_invalid']);
    }

    public function test_state_is_self_contained_so_concurrent_sign_ins_all_work(): void
    {
        // The failure this replaces: two tabs each started a sign-in, the
        // second overwrote the single state cookie, and the first callback
        // then failed validation with "sign-in could not be completed".
        $this->configureGoogle();
        $this->fakeGoogleProfile([
            'sub' => 'google-sub-concurrent',
            'email' => 'concurrent@gmail.com',
            'email_verified' => true,
            'name' => 'Concurrent Athlete',
        ]);

        // signup intent: this Google address has no TRANA account yet, and the
        // point of the test is that both attempts survive, not which one wins.
        $first = $this->beginGoogleFlow('signup');
        $second = $this->beginGoogleFlow('signup');
        $this->assertNotSame($first['state'], $second['state'], 'each attempt needs its own state');

        // Both complete, in either order, with no shared storage to conflict.
        $this->finishGoogleFlow($second)->assertRedirect('https://trana.test/');
        $this->finishGoogleFlow($first)->assertRedirect('https://trana.test/');
    }

    public function test_a_tampered_state_is_rejected_without_contacting_google(): void
    {
        $this->configureGoogle();
        Http::fake();
        $flow = $this->beginGoogleFlow();

        // Flip one payload character but keep the MAC: must not verify.
        $parts = explode('.', $flow['state']);
        $tampered = $parts[0].'.'.$parts[1].'x'.$parts[2];

        $this->finishGoogleFlow($flow, $tampered)
            ->assertRedirect('https://trana.test/login?google=session_expired');

        Http::assertNothingSent();
        $this->assertSame(0, User::query()->count());
    }

    public function test_an_expired_state_is_rejected(): void
    {
        $this->configureGoogle();
        Http::fake();
        $flow = $this->beginGoogleFlow();

        // Re-encode the payload with an old timestamp, keeping a valid MAC so
        // the clock check (not the signature) is what rejects it.
        $parts = explode('.', $flow['state']);
        $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);
        $payload['t'] = time() - 3600;
        $encoded = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
        $key = hash_hmac('sha256', 'trana-google-oauth-state', (string) config('app.key'), true);
        $stale = 'v1.'.$encoded.'.'.hash_hmac('sha256', 'v1.'.$encoded, $key);

        $this->finishGoogleFlow($flow, $stale)
            ->assertRedirect('https://trana.test/login?google=session_expired');

        Http::assertNothingSent();
    }

    public function test_the_state_is_never_left_in_the_browser_as_a_cookie(): void
    {
        $this->configureGoogle();

        $response = $this->get('/api/auth/google/redirect')->assertRedirect();

        $this->assertNull(
            $this->responseCookie($response, self::STATE_COOKIE),
            'a state cookie can only hold one in-flight sign-in',
        );
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
