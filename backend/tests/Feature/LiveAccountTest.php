<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Mockery;
use Illuminate\Support\Facades\Route;
use Tests\Support\AuthTestHelpers;
use Tests\TestCase;

class LiveAccountTest extends TestCase
{
    use RefreshDatabase;
    use AuthTestHelpers;

    private function registerAthlete(string $name, string $email): string
    {
        return $this->createVerifiedAccount($name, $email)['token'];
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

        // Mock only the default connection. A bare `DB::shouldReceive()` makes
        // the DatabaseManager itself a partial mock with no expectation for
        // getConnections(), which any later facade call in this process then
        // trips over with BadMethodCallException.
        $manager = Mockery::mock(DB::getFacadeRoot())->makePartial();
        $manager->shouldReceive('getConnections')->andReturn([]);
        $manager->shouldReceive('connection')->andReturn(Mockery::mock(Connection::class)->makePartial());
        $manager->shouldReceive('selectOne')->once()->with('select 1')
            ->andThrow(new \RuntimeException('private-database-detail'));
        DB::swap($manager);

        try {
            $this->getJson('/api/health')
                ->assertStatus(503)
                ->assertJsonPath('status', 'unavailable')
                ->assertDontSee('private-database-detail');
        } finally {
            // Restore the real manager for every test that runs afterwards.
            DB::clearResolvedInstances();
            DB::swap(app('db'));
        }
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

        $token = $this->registerAthlete('Alice', 'alice@gmail.com');
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
        $tokenA = $this->registerAthlete('Alice', 'alice@gmail.com');
        $alice = User::where('email', 'alice@gmail.com')->firstOrFail();
        $this->assertTrue(password_get_info($alice->password)['algoName'] === 'bcrypt');
        $this->assertNotEmpty($alice->username);
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

        $tokenB = $this->registerAthlete('Bob', 'bob@gmail.com');
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
        $newToken = $this->signInToAccount('alice@gmail.com')['token'];
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
        $token = $this->registerAthlete('Alice', 'alice@gmail.com');
        $headers = $this->bearer($token);
        $alice = User::where('email', 'alice@gmail.com')->firstOrFail();
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

    public function test_activity_export_streams_the_athletes_own_csv(): void
    {
        // Regression: exportCsv() once type-hinted a non-existent
        // Illuminate\Support\StreamedResponse, so every export request died
        // with a 500 in production while no test exercised the route.
        $token = $this->registerAthlete('Exporter', 'exporter@gmail.com');
        $headers = $this->bearer($token);
        $athlete = User::where('email', 'exporter@gmail.com')->firstOrFail();

        $this->postJson('/api/activities', [
            'activity_type' => 'run', 'distance_km' => 5, 'duration_min' => 30,
            'calories' => 320, 'notes' => 'Morning 5k', 'started_at' => now()->toIso8601String(),
        ], $headers)->assertCreated();
        $otherUser = User::create([
            'name' => 'Other Athlete',
            'username' => 'other_athlete',
            'email' => 'other@gmail.com',
            'password' => 'Fixture-password-123',
        ]);
        $otherUser->activities()->create([
            'activity_type' => 'ride', 'distance_km' => 40, 'duration_min' => 90,
            'notes' => 'Someone else ride', 'started_at' => now(),
        ]);

        $response = $this->get('/api/activities/export', $headers);
        $response->assertOk();
        $this->assertStringContainsString('text/csv', (string) $response->headers->get('Content-Type'));
        // Symfony picks the header format (quoted vs token) from the filename
        // and version, so assert the stable parts rather than exact quoting.
        $disposition = (string) $response->headers->get('Content-Disposition');
        $this->assertStringContainsString('attachment;', $disposition);
        $this->assertStringContainsString('filename=', $disposition);
        $this->assertStringContainsString('trana-activities-'.$athlete->id.'-', $disposition);
        $this->assertStringContainsString('.csv', $disposition);

        $csv = $response->streamedContent();
        $rows = array_values(array_filter(array_map('str_getcsv', preg_split('/\r\n|\n/', trim($csv)))));
        $this->assertSame('id', $rows[0][0]);
        $this->assertContains('activity_type', $rows[0]);
        $this->assertCount(2, $rows, 'Header plus the athlete\'s single activity.');
        $this->assertSame('run', $rows[1][1]);
        $this->assertStringContainsString('Morning 5k', $csv);
        $this->assertStringNotContainsString('Someone else ride', $csv);

        // The export must not open up to callers without a session.
        app('auth')->forgetGuards();
        $this->get('/api/activities/export')->assertUnauthorized();
    }
}
