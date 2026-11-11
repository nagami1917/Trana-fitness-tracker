<?php

namespace Tests\Feature;

use App\Models\DailySession;
use App\Models\DailySessionFood;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DailySessionTest extends TestCase
{
    use RefreshDatabase;

    private function registerAthlete(string $email = 'session@gmail.com'): array
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Track Athlete',
            'email' => $email,
            'password' => 'test-password-123',
        ])->assertCreated();

        app('auth')->forgetGuards();

        return ['Authorization' => 'Bearer '.$response->json('token')];
    }

    public function test_today_session_lifecycle_preserves_existing_values_on_partial_post(): void
    {
        $headers = $this->registerAthlete();

        // No session yet today.
        $this->getJson('/api/daily-sessions/today', $headers)
            ->assertOk()
            ->assertJsonPath('data', null);

        // Start today's session via POST.
        $created = $this->postJson('/api/daily-sessions/today', [
            'calories_burned' => 320,
            'water_ml' => 600,
            'notes' => 'Morning run',
        ], $headers)->assertCreated();

        $created->assertJsonPath('data.calories_burned', 320)
            ->assertJsonPath('data.calories_eaten', 0)
            ->assertJsonPath('data.water_ml', 600)
            ->assertJsonPath('data.net_calories', -320);

        $sessionId = $created->json('data.id');

        // Add food so calories_eaten becomes 450.
        $this->postJson("/api/daily-sessions/{$sessionId}/foods", [
            'meal_type' => 'breakfast',
            'food_name' => 'Oatmeal with banana',
            'calories' => 450,
            'carbs_g' => 72,
            'protein_g' => 14,
            'fat_g' => 9,
            'quantity' => 1,
        ], $headers)->assertCreated();

        // Subsequent partial POST (e.g. finishing a second workout) must not wipe calories_eaten or water_ml.
        $updated = $this->postJson('/api/daily-sessions/today', [
            'calories_burned' => 520,
        ], $headers)->assertCreated();

        $updated->assertJsonPath('data.calories_burned', 520)
            ->assertJsonPath('data.calories_eaten', 450)
            ->assertJsonPath('data.water_ml', 600)
            ->assertJsonPath('data.notes', 'Morning run')
            ->assertJsonPath('data.net_calories', -70);

        // List endpoint includes session_date as YYYY-MM-DD and accurate foods_count.
        $list = $this->getJson('/api/daily-sessions', $headers)->assertOk();
        $list->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.foods_count', 1);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $list->json('data.0.session_date'));
    }

    public function test_food_update_and_delete_recompute_calories_eaten_and_enforce_ownership(): void
    {
        $headersA = $this->registerAthlete('food-a@gmail.com');
        $sessionId = $this->postJson('/api/daily-sessions/today', [], $headersA)
            ->assertCreated()
            ->json('data.id');

        $foodRes = $this->postJson("/api/daily-sessions/{$sessionId}/foods", [
            'meal_type' => 'lunch',
            'food_name' => 'Chicken rice bowl',
            'calories' => 600,
            'carbs_g' => 68,
            'protein_g' => 38,
            'fat_g' => 16,
            'quantity' => 1,
        ], $headersA)->assertCreated();

        $foodId = $foodRes->json('data.id');
        $foodRes->assertJsonPath('session.calories_eaten', 600);

        // Update bound {dailySessionFood} and confirm calories_eaten updates.
        $this->putJson("/api/daily-sessions/{$sessionId}/foods/{$foodId}", [
            'food_name' => 'Chicken rice bowl (large)',
            'calories' => 780,
        ], $headersA)
            ->assertOk()
            ->assertJsonPath('data.food_name', 'Chicken rice bowl (large)')
            ->assertJsonPath('data.calories', 780)
            ->assertJsonPath('session.calories_eaten', 780);

        // Cross-athlete isolation: user B cannot view, modify, or delete user A's session/foods.
        $headersB = $this->registerAthlete('food-b@gmail.com');
        app('auth')->forgetGuards();

        $this->getJson("/api/daily-sessions/{$sessionId}", $headersB)->assertNotFound();
        $this->putJson("/api/daily-sessions/{$sessionId}/foods/{$foodId}", ['calories' => 100], $headersB)->assertNotFound();
        $this->deleteJson("/api/daily-sessions/{$sessionId}/foods/{$foodId}", [], $headersB)->assertNotFound();
        $this->assertNotNull(DailySessionFood::find($foodId));

        app('auth')->forgetGuards();

        // Owner delete removes row and resets calories_eaten to 0.
        $this->deleteJson("/api/daily-sessions/{$sessionId}/foods/{$foodId}", [], $headersA)
            ->assertOk()
            ->assertJsonPath('deleted', true)
            ->assertJsonPath('session.calories_eaten', 0);

        $this->assertNull(DailySessionFood::find($foodId));
        $this->assertSame(0, (int) DailySession::findOrFail($sessionId)->calories_eaten);
    }

    public function test_gps_tracked_activity_persists_tracking_metadata(): void
    {
        $headers = $this->registerAthlete('gps-track@gmail.com');

        $started = now()->subMinutes(18)->toIso8601String();
        $ended = now()->subMinute()->toIso8601String();

        $res = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'started_at' => $started,
            'ended_at' => $ended,
            'distance_km' => 3.2,
            'duration_min' => 17.0,
            'average_speed' => 11.3,
            'average_pace' => 5.31,
            'elevation_gain_m' => 24,
            'calories' => 210,
            'route' => [[14.676, 121.0437], [14.686, 121.0537]],
            'route_geojson' => [
                'type' => 'FeatureCollection',
                'features' => [[
                    'type' => 'Feature',
                    'properties' => ['activity_type' => 'run'],
                    'geometry' => [
                        'type' => 'LineString',
                        'coordinates' => [[121.0437, 14.676], [121.0537, 14.686]],
                    ],
                ]],
            ],
            'notes' => 'Tracked with TRANA live map',
            'source' => 'gps',
        ], $headers)->assertCreated();

        $res->assertJsonPath('data.source', 'gps')
            ->assertJsonPath('data.average_speed', 11.3)
            ->assertJsonPath('data.average_pace', 5.31);
        $this->assertNotNull($res->json('data.ended_at'));
    }
}
