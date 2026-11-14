<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\GoogleAuthTestHelpers;
use Tests\TestCase;

class StatelessApiTest extends TestCase
{
    use RefreshDatabase;
    use GoogleAuthTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepareGoogleAuth();
    }

    private const FRONTEND = [
        'Origin' => 'http://localhost:5173',
        'Referer' => 'http://localhost:5173/register',
    ];

    public function test_browser_origin_can_register_and_write_without_cookie_csrf(): void
    {
        // PHPUnit normally bypasses CSRF middleware. Simulate a real local
        // server so this test fails if stateful SPA middleware is re-enabled.
        config(['sanctum.stateful' => ['localhost:5173']]);
        $previousEnvironment = app()->environment();
        app()->instance('env', 'local');

        try {
            $nonce = $this->requestGoogleNonce(self::FRONTEND);
            $verified = $this->postJson('/api/auth/google', [
                'credential' => $this->googleCredential($nonce, [
                    'sub' => 'browser-google-sub',
                    'email' => 'browser@example.com',
                    'name' => 'Browser Athlete',
                ]),
            ], self::FRONTEND)->assertOk();
            $verified->assertCookieMissing(config('session.cookie'));
            $token = $verified->json('token');

            app('auth')->forgetGuards();
            $this->putJson('/api/profile', ['weight_kg' => 68], self::FRONTEND + [
                'Authorization' => 'Bearer '.$token,
            ])->assertOk()->assertJsonPath('data.weight_kg', 68);
        } finally {
            app()->instance('env', $previousEnvironment);
        }
    }

    public function test_cookie_session_cannot_authenticate_the_token_only_api(): void
    {
        // Simulate an already-authenticated web guard. The API must neither
        // accept that session alone nor prefer it over a different bearer user.
        $this->assertSame([], config('sanctum.guard'));
        $sessionUser = User::create([
            'name' => 'Session User', 'email' => 'session@gmail.com', 'password' => null,
        ]);
        $sessionUser->forceFill(['email_verified_at' => now()])->save();
        $tokenUser = User::create([
            'name' => 'Bearer User', 'email' => 'bearer@gmail.com', 'password' => null,
        ]);
        $tokenUser->forceFill(['email_verified_at' => now()])->save();
        $token = $tokenUser->createToken('test')->plainTextToken;

        $this->actingAs($sessionUser, 'web');
        $this->getJson('/api/auth/me', self::FRONTEND)->assertUnauthorized();

        app('auth')->forgetGuards();
        $this->actingAs($sessionUser, 'web');
        $this->getJson('/api/auth/me', self::FRONTEND + [
            'Authorization' => 'Bearer '.$token,
        ])->assertOk()->assertJsonPath('user.id', $tokenUser->id);
    }
}
