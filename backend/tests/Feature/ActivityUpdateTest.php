<?php

namespace Tests\Feature;

use App\Models\Activity;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ActivityUpdateTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = 'test-password-123';

    private function registerAthlete(string $email): string
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Athlete',
            'email' => $email,
            'password' => self::PASSWORD,
        ])->assertCreated();

        return $response->json('token');
    }

    private function bearer(string $token): array
    {
        app('auth')->forgetGuards();

        return ['Authorization' => 'Bearer '.$token];
    }

    public function test_owner_can_edit_activity_and_recalculate_metrics(): void
    {
        $token = $this->registerAthlete('runner@gmail.com');

        $created = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 5.0,
            'duration_min' => 30,
            'elevation_gain_m' => 25,
            'started_at' => now()->subHours(3)->toIso8601String(),
            'notes' => 'Initial note',
        ], $this->bearer($token))->assertCreated();

        $activityId = $created->json('data.id');
        $initialCalories = (int) $created->json('data.calories');

        $updated = $this->patchJson("/api/activities/{$activityId}", [
            'distance_km' => 10.5,
            'duration_min' => 52.5,
            'notes' => 'Corrected GPS distance',
        ], $this->bearer($token))->assertOk();

        $updated->assertJsonPath('data.distance_km', 10.5)
            ->assertJsonPath('data.duration_min', 52.5)
            ->assertJsonPath('data.notes', 'Corrected GPS distance');

        $this->assertGreaterThan($initialCalories, (int) $updated->json('data.calories'));
        $this->assertEqualsWithDelta(5.0, (float) $updated->json('data.average_pace'), 0.05);

        $this->patchJson("/api/activities/{$activityId}", [
            'ended_at' => now()->subDays(2)->toIso8601String(),
        ], $this->bearer($token))->assertUnprocessable();
    }

    public function test_explicit_calories_override_is_respected_and_other_users_blocked(): void
    {
        $tokenA = $this->registerAthlete('alice@gmail.com');
        $tokenB = $this->registerAthlete('bob@gmail.com');

        $created = $this->postJson('/api/activities', [
            'activity_type' => 'ride',
            'distance_km' => 20,
            'duration_min' => 50,
            'started_at' => now()->subDay()->toIso8601String(),
        ], $this->bearer($tokenA))->assertCreated();

        $activityId = $created->json('data.id');

        $this->patchJson("/api/activities/{$activityId}", [
            'calories' => 640,
            'avg_heart_rate' => 148,
        ], $this->bearer($tokenA))
            ->assertOk()
            ->assertJsonPath('data.calories', 640)
            ->assertJsonPath('data.avg_heart_rate', 148);

        $this->patchJson("/api/activities/{$activityId}", [
            'notes' => 'Tamper attempt',
        ], $this->bearer($tokenB))->assertNotFound();

        $this->assertSame('ride', Activity::findOrFail($activityId)->activity_type);
    }
}
