<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\AuthTestHelpers;
use Tests\TestCase;

class StatelessApiTest extends TestCase
{
    use RefreshDatabase;
    use AuthTestHelpers;

    private const FRONTEND = [
        'Origin' => 'http://localhost:5173',
        'Referer' => 'http://localhost:5173/register',
    ];

    public function test_cookie_authenticated_writes_require_matching_csrf_and_trusted_origin(): void
    {
        $csrf = $this->getJson('/api/auth/csrf', self::FRONTEND)->assertOk()->json('csrfToken');
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $csrf);

        // Having the CSRF cookie without its matching header is rejected.
        $this->withCookie('trana_csrf', $csrf)
            ->postJson('/api/auth/register', [], self::FRONTEND)
            ->assertStatus(419);

        // A matching token is still not enough when the browser Origin is untrusted.
        $this->withCookie('trana_csrf', $csrf)
            ->postJson('/api/auth/register', [], [
                'Origin' => 'https://evil.example',
                'X-CSRF-TOKEN' => $csrf,
            ])->assertForbidden();

        // The configured SPA origin plus the matching double-submit token reaches validation.
        $this->withCookie('trana_csrf', $csrf)
            ->postJson('/api/auth/register', [], self::FRONTEND + ['X-CSRF-TOKEN' => $csrf])
            ->assertUnprocessable();
    }

    public function test_http_only_auth_cookie_works_without_web_sessions_and_bearer_token_takes_precedence(): void
    {
        $cookieAccount = $this->createVerifiedAccount('Cookie User', 'cookie@gmail.com');
        $bearerAccount = $this->createVerifiedAccount('Bearer User', 'bearer@gmail.com');

        // API routes remain stateless: a Laravel web guard session cannot grant API access.
        $this->assertSame([], config('sanctum.guard'));
        $this->actingAs(User::findOrFail($cookieAccount['user']['id']), 'web');
        $this->getJson('/api/auth/me')->assertUnauthorized();

        app('auth')->forgetGuards();
        $this->withCookie('trana_session', $cookieAccount['token'])
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('user.id', $cookieAccount['user']['id'])
            ->assertJsonPath('user.username', $cookieAccount['user']['username']);

        app('auth')->forgetGuards();
        $this->withCookie('trana_session', $cookieAccount['token'])
            ->getJson('/api/auth/me', ['Authorization' => 'Bearer '.$bearerAccount['token']])
            ->assertOk()
            ->assertJsonPath('user.id', $bearerAccount['user']['id']);
    }
}
