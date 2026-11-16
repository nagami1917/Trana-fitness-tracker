<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Cookie policy behind the same-origin rewrite.
 *
 * In production the SPA proxies `/api` through frontend/vercel.json, so the
 * browser only ever talks to one site and the session cookie is first-party.
 * That is what lets Brave, Safari and Firefox sign in at all: each of them
 * blocks third-party cookies by default, and a `SameSite=None` cookie set by a
 * second `*.vercel.app` host is exactly the thing they block.
 *
 * These tests pin the two halves that make that work: `lax` resolves, and the
 * cookie is still issued with Secure + HttpOnly + Path=/api.
 */
class SessionCookiePolicyTest extends TestCase
{
    use RefreshDatabase;

    private function loggedInCookie(): string
    {
        // `email_verified_at` is deliberately not mass-assignable, so it is set
        // after creation. Leaving it null would make login answer 403
        // EMAIL_NOT_VERIFIED and hide what this test is actually checking.
        $user = User::create([
            'name' => 'Cookie Policy',
            'username' => 'cookiep',
            'email' => 'cookiep@gmail.com',
            'password' => bcrypt('CorrectHorse9!'),
            'role' => User::ROLE_ATHLETE,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();
        $user->ensureProfile();
        $user->ensureGoals();

        $response = $this->postJson('/api/auth/login', [
            'identifier' => 'cookiep@gmail.com',
            'password' => 'CorrectHorse9!',
        ])->assertOk();

        $cookies = collect($response->headers->getCookies())
            ->filter(fn ($c) => $c->getName() === 'trana_session');
        $this->assertCount(1, $cookies, 'login must set the session cookie');

        return (string) $cookies->first()->getValue();
    }

    public function test_configured_same_site_lax_is_applied_to_the_session_cookie(): void
    {
        config(['services.trana.cookie_same_site' => 'lax']);

        $this->loggedInCookie();

        $cookie = collect($this->response->headers->getCookies())
            ->first(fn ($c) => $c->getName() === 'trana_session');

        $this->assertNotNull($cookie);
        $this->assertSame('lax', $cookie->getSameSite());
        $this->assertTrue($cookie->isSecure(), 'production cookies must stay Secure');
        $this->assertTrue($cookie->isHttpOnly(), 'the token must never be JS-readable');
        $this->assertSame('/api', $cookie->getPath());
    }

    public function test_unset_same_site_still_defaults_safely_outside_production(): void
    {
        config(['services.trana.cookie_same_site' => null]);

        $this->loggedInCookie();

        $cookie = collect($this->response->headers->getCookies())
            ->first(fn ($c) => $c->getName() === 'trana_session');

        $this->assertNotNull($cookie);
        // Non-production falls back to Lax: None requires HTTPS end to end.
        $this->assertSame('lax', $cookie->getSameSite());
    }

    public function test_first_party_cookie_authenticates_the_api(): void
    {
        config(['services.trana.cookie_same_site' => 'lax']);
        $token = $this->loggedInCookie();

        $this->withCredentials()
            ->withUnencryptedCookies(['trana_session' => $token])
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('user.username', 'cookiep');
    }
}
