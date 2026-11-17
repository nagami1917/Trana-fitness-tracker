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

        $first = $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))
            ->assertCreated()
            ->assertJsonPath('data.pace_min_per_km', 6.0)
            ->assertJsonPath('data.speed_kmh', 10.0)
            ->assertJsonPath('meta.remaining', 1)
            ->assertJsonPath('meta.complete', false);

        $this->assertSame('baseline', Activity::find($first->json('data.id'))->source);
        $this->assertTrue(Activity::find($first->json('data.id'))->is_baseline);

        $this->postJson('/api/baseline-activities', $this->payload([
            'activity_type' => 'ride',
            'distance_km' => 20,
            'duration_min' => 50,
        ]), $this->bearer($token))
            ->assertCreated()
            ->assertJsonPath('meta.remaining', 0)
            ->assertJsonPath('meta.complete', true);
    }

    public function test_a_third_baseline_is_refused_so_this_cannot_become_a_bulk_import(): void
    {
        $token = $this->registerAthlete();

        $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))->assertCreated();
        $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))->assertCreated();

        $this->postJson('/api/baseline-activities', $this->payload(), $this->bearer($token))
            ->assertStatus(409)
            ->assertJsonPath('code', 'BASELINE_COMPLETE');

        $this->assertSame(2, Activity::where('is_baseline', true)->count());
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
