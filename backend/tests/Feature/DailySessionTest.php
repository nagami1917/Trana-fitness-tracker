<?php

namespace Tests\Feature;

use App\Models\DailySession;
use App\Models\DailySessionFood;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\AuthTestHelpers;
use Tests\TestCase;

class DailySessionTest extends TestCase
{
    use RefreshDatabase;
    use AuthTestHelpers;

    private function registerAthlete(string $email = 'session@gmail.com'): array
    {
        $response = $this->createVerifiedAccount('Track Athlete', $email);
        app('auth')->forgetGuards();

        return ['Authorization' => 'Bearer '.$response['token']];
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
            ->assertJsonPath('data.average_pace', 5.31)
            ->assertJsonPath('data.route_geojson.type', 'FeatureCollection');
        $this->assertNotNull($res->json('data.ended_at'));

        $id = $res->json('data.id');
        // List endpoint omits heavy route_geojson to keep boot payloads small; detail keeps it.
        $listRes = $this->getJson('/api/activities', $headers)->assertOk();
        $this->assertArrayNotHasKey('route_geojson', $listRes->json('data.0'));
        $this->getJson('/api/activities/'.$id, $headers)
            ->assertOk()
            ->assertJsonPath('data.route_geojson.type', 'FeatureCollection');
    }

    public function test_session_detail_returns_only_that_day_s_routes_for_that_user(): void
    {
        $headers = $this->registerAthlete();
        $user = \App\Models\User::query()->where('email', 'session@gmail.com')->firstOrFail();

        // A session for 2026-11-13.
        $session = DailySession::create([
            'user_id' => $user->id,
            'session_date' => '2026-11-13',
            'calories_burned' => 310,
            'calories_eaten' => 105,
        ]);

        // The real GPS tracker (liveTracker.svelte.js) stores a FeatureCollection
        // whose coordinates are [lng, lat] — use that exact shape here.
        $geojson = [
            'type' => 'FeatureCollection',
            'features' => [[
                'type' => 'Feature',
                'properties' => ['activity_type' => 'run'],
                'geometry' => [
                    'type' => 'LineString',
                    'coordinates' => [[121.035, 14.676], [121.042, 14.674]],
                ],
            ]],
        ];

        // On the day: one GPS activity, one manual activity.
        $onDay = $user->activities()->create([
            'activity_type' => 'run',
            'distance_km' => 1.56,
            'duration_min' => 3.7,
            'calories' => 92,
            'started_at' => '2026-11-13 09:25:24',
            'route_geojson' => $geojson,
            'source' => 'gps',
        ]);
        $user->activities()->create([
            'activity_type' => 'walk',
            'distance_km' => 0.8,
            'duration_min' => 9,
            'started_at' => '2026-11-13 19:02:00',
            'source' => 'manual',
        ]);

        // Same user, different day — must not appear.
        $user->activities()->create([
            'activity_type' => 'ride',
            'distance_km' => 40,
            'duration_min' => 90,
            'started_at' => '2026-11-12 08:00:00',
            'source' => 'gps',
        ]);

        // Another user on the same day — must not appear.
        $other = \App\Models\User::create([
            'name' => 'Other Athlete',
            'username' => 'other_athlete',
            'email' => 'other@gmail.com',
            'password' => bcrypt('Runner-pass-123'),
        ]);
        $other->forceFill(['email_verified_at' => now()])->save();
        $other->activities()->create([
            'activity_type' => 'hike',
            'distance_km' => 6,
            'duration_min' => 70,
            'started_at' => '2026-11-13 07:00:00',
            'source' => 'gps',
        ]);

        $response = $this->getJson("/api/daily-sessions/{$session->id}", $headers)->assertOk();

        // Exactly the two activities from that day, in chronological order.
        $response->assertJsonCount(2, 'data.activities')
            ->assertJsonPath('data.activities.0.id', $onDay->id)
            ->assertJsonPath('data.activities.0.has_route', true)
            ->assertJsonPath('data.activities.0.route_geojson.type', 'FeatureCollection')
            ->assertJsonPath(
                'data.activities.0.route_geojson.features.0.geometry.coordinates.0.0',
                121.035
            )
            ->assertJsonPath('data.activities.1.has_route', false)
            ->assertJsonPath('data.activities.1.source', 'manual');

        // The route array is still exposed for the legacy fallback.
        $this->assertArrayHasKey('route', $response->json('data.activities.0'));
    }

    public function test_session_detail_still_hides_another_user_s_session(): void
    {
        $this->registerAthlete('owner@gmail.com');
        $owner = \App\Models\User::query()->where('email', 'owner@gmail.com')->firstOrFail();

        $session = DailySession::create([
            'user_id' => $owner->id,
            'session_date' => '2026-11-13',
        ]);

        $intruder = $this->createVerifiedAccount('Intruder', 'intruder@gmail.com');
        app('auth')->forgetGuards();

        $this->getJson("/api/daily-sessions/{$session->id}", ['Authorization' => 'Bearer '.$intruder['token']])
            ->assertNotFound();
    }
}
