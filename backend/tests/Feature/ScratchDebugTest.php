<?php
namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ScratchDebugTest extends TestCase
{
    use RefreshDatabase;

    public function test_debug_login_response(): void
    {
        $user = User::create([
            'name' => 'Cookie Policy',
            'username' => 'cookiep',
            'email' => 'cookiep@gmail.com',
            'password' => bcrypt('CorrectHorse9!'),
            'role' => User::ROLE_ATHLETE,
            'email_verified_at' => now(),
        ]);
        $user->ensureProfile();
        $user->ensureGoals();

        $response = $this->postJson('/api/auth/login', [
            'identifier' => 'cookiep@gmail.com',
            'password' => 'CorrectHorse9!',
        ]);
        $this->assertSame(200, $response->status(), "DEBUG BODY: ".$response->getContent());
    }
}
