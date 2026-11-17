<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\AuthTestHelpers;
use Tests\TestCase;

/**
 * The onboarding baseline: two past sessions, entered once, used only to teach
 * the duration model the athlete's own pace.
 */
class BaselineActivityTest extends TestCase
{
    use RefreshDatabase;
    use AuthTestHelpers;

    private function registerAthlete(string $email = 'baseline@gmail.com'): string
    {
        return $this->createVerifiedAccount('Baseline Athlete', $email)['token'];
    }

    private function bearer(string $token): array
    {
        app('auth')->forgetGuards();

        return ['Authorization' => 'Bearer '.$token];
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'activity_type' => 'run',
            'distance_km' => 5,
            'duration_min' => 30,
            'elevation_gain_m' => 40,
            'performed_on' => now()->subDays(7)->toDateString(),
        ], $overrides);
    }

    public function test_athlete_can_store_two_baseline_sessions_and_pace_is_derived(): void
    {
        $token = $this->registerAthlete();

        $first = $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token));

        // Surface the validator's own words if this ever regresses.
        $this->assertSame(201, $first->status(), 'baseline create failed: '.$first->getContent());

        $first->assertJsonPath('data.pace_min_per_km', 6)
            ->assertJsonPath('data.speed_kmh', 10)
            ->assertJsonPath('meta.by_type.run.count', 1)
            ->assertJsonPath('meta.by_type.run.remaining', 1)
            ->assertJsonPath('meta.by_type.run.complete', false)
            ->assertJsonPath('meta.by_type.ride.count', 0);

        $this->assertSame('baseline', Activity::find($first->json('data.id'))->source);
        $this->assertTrue(Activity::find($first->json('data.id'))->is_baseline);

        // A second sport is independent: walk is complete, ride is untouched.
        $this->postJson('/api/baseline-activities', $this->payload([
            'activity_type' => 'ride',
            'distance_km' => 20,
            'duration_min' => 50,
        ]), $this->bearer($token))
            ->assertCreated()
            ->assertJsonPath('meta.by_type.run.complete', true)
            ->assertJsonPath('meta.by_type.ride.count', 1)
            ->assertJsonPath('meta.by_type.ride.complete', false);
    }

    public function test_a_third_baseline_is_refused_so_this_cannot_become_a_bulk_import(): void
    {
        $token = $this->registerAthlete();

        $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))->assertCreated();
        $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))->assertCreated();

        $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))
            ->assertStatus(409)
            ->assertJsonPath('code', 'BASELINE_COMPLETE')
            ->assertJsonPath('activity_type', 'run');

        $this->assertSame(2, Activity::where('is_baseline', true)->count());
    }

    public function test_the_cap_is_per_activity_type_so_walk_does_not_block_ride(): void
    {
        // The whole point: an athlete who only walks must still be able to
        // teach the model their cycling pace, and vice versa.
        $token = $this->registerAthlete();

        $this->postJson('/api/baseline-activities', $this->payload([
            'activity_type' => 'walk', 'distance_km' => 4, 'duration_min' => 45,
        ]), $this->bearer($token))->assertCreated();
        $this->postJson('/api/baseline-activities', $this->payload([
            'activity_type' => 'walk', 'distance_km' => 6, 'duration_min' => 70,
        ]), $this->bearer($token))->assertCreated();

        // walk is full...
        $this->postJson('/api/baseline-activities', $this->payload([
            'activity_type' => 'walk', 'distance_km' => 5, 'duration_min' => 60,
        ]), $this->bearer($token))->assertStatus(409);

        // ...but ride, run and hike each still have two free slots.
        foreach (['ride', 'run', 'hike'] as $type) {
            $this->postJson('/api/baseline-activities', $this->payload([
                'activity_type' => $type, 'distance_km' => 8, 'duration_min' => 60,
            ]), $this->bearer($token))->assertCreated();
        }

        $this->getJson('/api/baseline-activities', $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('meta.by_type.walk.complete', true)
            ->assertJsonPath('meta.by_type.ride.count', 1)
            ->assertJsonPath('meta.by_type.run.count', 1)
            ->assertJsonPath('meta.by_type.hike.count', 1);
    }

    public function test_pace_is_an_accepted_alternative_to_a_duration(): void
    {
        // "5 km at 6:00/km" and "5 km in 30 min" are the same session and must
        // store identically, so the model cannot be fed a different number
        // depending on which field the athlete happened to fill in.
        $token = $this->registerAthlete();

        $this->postJson('/api/baseline-activities', [
            'activity_type' => 'run',
            'distance_km' => 5,
            'pace_min_per_km' => 6,
            'performed_on' => now()->subDays(7)->toDateString(),
        ], $this->bearer($token))
            ->assertCreated()
            ->assertJsonPath('data.duration_min', 30)
            ->assertJsonPath('data.pace_min_per_km', 6);
    }

    public function test_an_implausible_speed_is_refused_instead_of_saved_then_ignored(): void
    {
        // The model silently drops history rows outside SPEED_BOUNDS_KMH. If the
        // API accepted them the athlete would be told "based on your 2 sessions"
        // while the curve was fitted from none of them.
        $token = $this->registerAthlete();

        // 5 km in 15 min = 20 km/h: far too fast for a walk (max 14).
        $this->postJson('/api/baseline-activities', $this->payload([
            'activity_type' => 'walk',
            'distance_km' => 5,
            'duration_min' => 15,
        ]), $this->bearer($token))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['distance_km']);

        $this->assertSame(0, Activity::where('is_baseline', true)->count());

        // The same numbers are plausible for a ride (max 65 km/h).
        $this->postJson('/api/baseline-activities', $this->payload([
            'activity_type' => 'ride',
            'distance_km' => 5,
            'duration_min' => 15,
        ]), $this->bearer($token))->assertCreated();
    }

    public function test_a_partial_update_does_not_require_the_other_fields(): void
    {
        // Athletes mistype one number; PATCHing just that number must work even
        // though neither a duration nor a pace is present in the request.
        $token = $this->registerAthlete();
        $created = $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))
            ->assertCreated();
        $id = $created->json('data.id');

        $this->patchJson("/api/baseline-activities/{$id}", ['distance_km' => 6], $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('data.distance_km', 6)
            // 30 min over the corrected 6 km.
            ->assertJsonPath('data.pace_min_per_km', 5);
    }

    public function test_a_partial_update_accepts_a_bare_pace(): void
    {
        $token = $this->registerAthlete();
        $created = $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))
            ->assertCreated();
        $id = $created->json('data.id');

        // 5 km at 5:00/km = 25 min, without restating the distance.
        $this->patchJson("/api/baseline-activities/{$id}", ['pace_min_per_km' => 5], $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('data.duration_min', 25)
            ->assertJsonPath('data.pace_min_per_km', 5);
    }

    public function test_a_relative_period_resolves_to_a_past_date(): void
    {
        $token = $this->registerAthlete();

        $response = $this->postJson('/api/baseline-activities', [
            'activity_type' => 'run',
            'distance_km' => 5,
            'duration_min' => 30,
            'performed_period' => 'last_week',
        ], $this->bearer($token))->assertCreated();

        $stored = Activity::findOrFail($response->json('data.id'));
        $this->assertTrue($stored->started_at->isPast());
        $this->assertTrue($stored->started_at->greaterThan(now()->subDays(14)));
    }

    public function test_baseline_rows_stay_out_of_dashboard_numbers_and_earned_experience(): void
    {
        $token = $this->registerAthlete();
        $user = User::where('email', 'baseline@gmail.com')->firstOrFail();

        $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))->assertCreated();
        $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))->assertCreated();

        // Two remembered sessions must not read as two logged workouts.
        $this->getJson('/api/activities', $this->bearer($token))
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->getJson('/api/activities/summary', $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('data.totals.sessions', 0)
            ->assertJsonPath('data.totals.distance_km', 0);

        // ...nor promote a beginner through the activity-count heuristic.
        $this->assertSame(1, $user->fitnessProfile()->first()->experience_level);
    }

    public function test_future_and_impossible_baselines_are_rejected(): void
    {
        $token = $this->registerAthlete();

        $this->postJson('/api/baseline-activities', $this->payload([
            'performed_on' => now()->addDay()->toDateString(),
        ]), $this->bearer($token))->assertUnprocessable()->assertJsonValidationErrors(['performed_on']);

        $this->postJson('/api/baseline-activities', $this->payload([
            'distance_km' => 0,
        ]), $this->bearer($token))->assertUnprocessable()->assertJsonValidationErrors(['distance_km']);

        $this->postJson('/api/baseline-activities', $this->payload([
            'activity_type' => 'swim',
        ]), $this->bearer($token))->assertUnprocessable()->assertJsonValidationErrors(['activity_type']);
    }

    public function test_baseline_endpoints_are_private_to_their_owner(): void
    {
        $token = $this->registerAthlete();
        $created = $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))
            ->assertCreated();
        $id = $created->json('data.id');

        $other = $this->registerAthlete('someone.else@gmail.com');

        $this->deleteJson("/api/baseline-activities/{$id}", [], $this->bearer($other))->assertNotFound();
        $this->patchJson("/api/baseline-activities/{$id}", ['distance_km' => 9], $this->bearer($other))
            ->assertNotFound();

        // A real (non-baseline) activity must not be editable through this route
        // either, or the cap could be bypassed by flipping rows around.
        $logged = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 3,
            'duration_min' => 20,
            'started_at' => now()->subDay()->toIso8601String(),
        ], $this->bearer($token))->assertCreated();

        $this->deleteJson('/api/baseline-activities/'.$logged->json('data.id'), [], $this->bearer($token))
            ->assertNotFound();
    }

    public function test_preferred_activities_round_trip_in_canonical_order(): void
    {
        $token = $this->registerAthlete();

        $this->patchJson('/api/profile', [
            'preferred_activities' => ['hike', 'ride', 'ride'],
        ], $this->bearer($token))->assertOk();

        $user = User::where('email', 'baseline@gmail.com')->firstOrFail();
        // Canonical Activity::TYPES order, de-duplicated.
        $this->assertSame(['ride', 'hike'], $user->fitnessProfile()->first()->preferred_activities);

        $this->getJson('/api/profile', $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('data.preferred_activities', ['ride', 'hike']);
    }

    public function test_unknown_preferred_activity_is_rejected(): void
    {
        $token = $this->registerAthlete();

        $this->patchJson('/api/profile', [
            'preferred_activities' => ['swim'],
        ], $this->bearer($token))->assertUnprocessable()->assertJsonValidationErrors(['preferred_activities.0']);
    }
}
