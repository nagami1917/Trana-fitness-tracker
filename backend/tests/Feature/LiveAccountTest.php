<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class LiveAccountTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = 'test-password-123';

    private function registerAthlete(string $name, string $email): string
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => $name,
            'email' => $email,
            'password' => self::PASSWORD,
        ])->assertCreated();

        return $response->json('token');
    }

    private function bearer(string $token): array
    {
        // Laravel's test process reuses guards across requests; real HTTP requests do not.
        app('auth')->forgetGuards();

        return ['Authorization' => 'Bearer '.$token];
    }

    public function test_health_reports_database_connection_without_leaking_errors(): void
    {
        $this->getJson('/api/health')->assertOk()->assertExactJson(['status' => 'ok']);

        DB::shouldReceive('selectOne')->once()->with('select 1')
            ->andThrow(new \RuntimeException('private-database-detail'));

        $this->getJson('/api/health')
            ->assertStatus(503)
            ->assertJsonPath('status', 'unavailable')
            ->assertDontSee('private-database-detail');
    }

    public function test_internal_errors_are_generic_even_with_debug_enabled(): void
    {
        Route::get('/api/test-error', fn () => throw new \RuntimeException('sensitive-internal-detail'));
        $this->getJson('/api/test-error')
            ->assertStatus(500)
            ->assertJsonPath('message', 'Something went wrong on our side.')
            ->assertDontSee('sensitive-internal-detail');
    }

    public function test_default_seed_and_demo_routes_do_not_create_or_reset_data(): void
    {
        $this->seed();
        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseCount('activities', 0);
        $this->assertDatabaseCount('predictions', 0);
        $this->postJson('/api/auth/demo')->assertNotFound();

        $token = $this->registerAthlete('Alice', 'alice@example.test');
        $this->postJson('/api/activities', [
            'activity_type' => 'run', 'distance_km' => 5, 'duration_min' => 30,
            'started_at' => now()->subDay()->toIso8601String(),
        ], $this->bearer($token))->assertCreated();
        $this->postJson('/api/demo/reset', [], $this->bearer($token))->assertNotFound();
        $this->assertDatabaseCount('activities', 1);
    }

    public function test_real_account_data_persists_and_is_isolated_between_users(): void
    {
        $this->getJson('/api/profile')->assertUnauthorized();
        $tokenA = $this->registerAthlete('Alice', 'alice@example.test');
        $alice = User::where('email', 'alice@example.test')->firstOrFail();
        $this->assertTrue(Hash::check(self::PASSWORD, $alice->password));
        $this->assertDatabaseHas('fitness_profiles', ['user_id' => $alice->id]);
        $this->assertDatabaseHas('goals', ['user_id' => $alice->id]);

        $this->putJson('/api/profile', [
            'weight_kg' => 67, 'city' => 'Lusacan', 'onboarded' => true,
        ], $this->bearer($tokenA))->assertOk()->assertJsonPath('data.onboarded', true);
        $this->putJson('/api/goals', ['daily_calories' => 2800], $this->bearer($tokenA))
            ->assertOk()->assertJsonPath('data.daily_calories', 2800);
        $activity = $this->postJson('/api/activities', [
            'activity_type' => 'run', 'distance_km' => 5.5, 'duration_min' => 35,
            'notes' => 'Alice private activity', 'started_at' => now()->subDay()->toIso8601String(),
        ], $this->bearer($tokenA))->assertCreated()->json('data.id');

        $prediction = $alice->predictions()->create([
            'activity_type' => 'run', 'distance_km' => 10,
            'duration_min' => 60, 'duration_low_min' => 50, 'duration_high_min' => 70,
        ]);

        $tokenB = $this->registerAthlete('Bob', 'bob@example.test');
        $headersB = $this->bearer($tokenB);
        $this->getJson('/api/profile', $headersB)->assertOk()->assertJsonPath('data.name', 'Bob');
        $this->getJson('/api/activities', $headersB)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/predictions', $headersB)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/activities/'.$activity, $headersB)->assertNotFound();
        $this->deleteJson('/api/activities/'.$activity, [], $headersB)->assertNotFound();
        $this->getJson('/api/predictions/'.$prediction->id, $headersB)->assertNotFound();
        $this->deleteJson('/api/predictions/'.$prediction->id, [], $headersB)->assertNotFound();
        $this->assertDatabaseHas('activities', ['id' => $activity, 'user_id' => $alice->id]);
        $this->assertDatabaseHas('predictions', ['id' => $prediction->id, 'user_id' => $alice->id]);

        $this->postJson('/api/auth/logout', [], $this->bearer($tokenA))->assertOk();
        $this->getJson('/api/auth/me', $this->bearer($tokenA))->assertUnauthorized();
        $newToken = $this->postJson('/api/auth/login', [
            'email' => 'alice@example.test', 'password' => self::PASSWORD,
        ])->assertOk()->json('token');
        $this->getJson('/api/profile', $this->bearer($newToken))
            ->assertOk()->assertJsonPath('data.city', 'Lusacan')->assertJsonPath('data.onboarded', true);
        $this->getJson('/api/goals', $this->bearer($newToken))
            ->assertOk()->assertJsonPath('data.daily_calories', 2800);
        $this->getJson('/api/activities', $this->bearer($newToken))->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_retraining_requires_an_explicit_source(): void
    {
        $this->artisan('trana:retrain')
            ->expectsOutput('Choose an explicit --source: synth, csv or supabase.')
            ->assertExitCode(1);
    }

    public function test_activity_and_prediction_lists_expose_all_pages(): void
    {
        $token = $this->registerAthlete('Alice', 'alice@example.test');
        $headers = $this->bearer($token);
        $alice = User::where('email', 'alice@example.test')->firstOrFail();
        for ($i = 1; $i <= 3; $i++) {
            $this->postJson('/api/activities', [
                'activity_type' => 'run', 'distance_km' => $i, 'duration_min' => 20,
                'notes' => 'Training session '.$i, 'started_at' => now()->subDay()->toIso8601String(),
            ], $headers)->assertCreated();
            $alice->predictions()->create([
                'activity_type' => 'run', 'distance_km' => $i,
                'duration_min' => 60, 'duration_low_min' => 50, 'duration_high_min' => 70,
            ]);
        }

        foreach (['activities', 'predictions'] as $resource) {
            $page1 = $this->getJson('/api/'.$resource.'?limit=1&page=1', $headers)
                ->assertOk()->assertJsonCount(1, 'data')
                ->assertJsonPath('meta.current_page', 1)->assertJsonPath('meta.last_page', 3)
                ->assertJsonPath('meta.total', 3);
            $page2 = $this->getJson('/api/'.$resource.'?limit=1&page=2', $headers)
                ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.current_page', 2);
            $this->assertNotSame($page1->json('data.0.id'), $page2->json('data.0.id'));
        }
        $this->getJson('/api/activities?q=TRAINING', $headers)->assertOk()->assertJsonCount(3, 'data');
        $this->getJson('/api/activities?page=0', $headers)->assertUnprocessable();
    }
}
