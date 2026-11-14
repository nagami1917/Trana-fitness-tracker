<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Gear;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TrainingFeaturesTest extends TestCase
{
    use RefreshDatabase;

    private function athlete(string $email = 'features@gmail.com'): User
    {
        $user = User::create([
            'name' => 'Features Athlete',
            'email' => $email,
            'password' => 'test-password-123',
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();

        return $user;
    }

    public function test_fuel_items_crud_and_user_isolation(): void
    {
        $userA = $this->athlete('a@gmail.com');
        $userB = $this->athlete('b@gmail.com');

        Sanctum::actingAs($userA);
        $created = $this->postJson('/api/fuel-items', [
            'name' => 'Maurten Gel 100',
            'category' => 'gel',
            'carbs_g' => 25,
            'sodium_mg' => 20,
            'fluid_ml' => 0,
            'serving_label' => 'sachet',
        ])->assertCreated()
            ->assertJsonPath('data.name', 'Maurten Gel 100');

        $id = $created->json('data.id');
        $this->patchJson("/api/fuel-items/{$id}", ['carbs_g' => 26])
            ->assertOk()
            ->assertJsonPath('data.carbs_g', 26);

        $this->getJson('/api/fuel-items')->assertOk()->assertJsonCount(1, 'data');

        Sanctum::actingAs($userB);
        $this->patchJson("/api/fuel-items/{$id}", ['name' => 'Hacked'])->assertNotFound();
        $this->deleteJson("/api/fuel-items/{$id}")->assertNotFound();

        Sanctum::actingAs($userA);
        $this->deleteJson("/api/fuel-items/{$id}")->assertOk();
        $this->getJson('/api/fuel-items')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_hr_zones_persist_on_profile(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        $zones = [
            ['zone' => 1, 'name' => 'Recovery', 'min' => 105, 'max' => 128],
            ['zone' => 2, 'name' => 'Aerobic', 'min' => 129, 'max' => 148],
            ['zone' => 3, 'name' => 'Tempo', 'min' => 149, 'max' => 162],
            ['zone' => 4, 'name' => 'Threshold', 'min' => 163, 'max' => 176],
            ['zone' => 5, 'name' => 'VO2 Max', 'min' => 177, 'max' => 190],
        ];

        $this->putJson('/api/profile', [
            'resting_hr' => 48,
            'max_hr' => 190,
            'hr_zones' => $zones,
        ])->assertOk()
            ->assertJsonPath('data.resting_hr', 48)
            ->assertJsonPath('data.max_hr', 190)
            ->assertJsonCount(5, 'data.hr_zones');
    }

    public function test_gear_mileage_syncs_with_activities_and_emits_wear_notification(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        $gearRes = $this->postJson('/api/gear', [
            'name' => 'Pegasus 41',
            'brand' => 'Nike',
            'sport' => 'run',
            'initial_km' => 490,
            'max_km' => 600,
            'is_default' => true,
        ])->assertCreated();
        $gearId = $gearRes->json('data.id');

        $actRes = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 25,
            'duration_min' => 140,
            'started_at' => now()->subDay()->toIso8601String(),
            'gear_id' => $gearId,
        ])->assertCreated();
        $actId = $actRes->json('data.id');

        $this->assertEqualsWithDelta(25.0, (float) Gear::findOrFail($gearId)->logged_km, 0.01);

        // 490 + 25 = 515 / 600 = 85.8% -> triggers gear_wear notification
        $this->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonFragment(['type' => 'gear_wear']);

        // Updating and deleting updates gear logged_km cleanly
        $this->patchJson("/api/activities/{$actId}", ['distance_km' => 30])->assertOk();
        $this->assertEqualsWithDelta(30.0, (float) Gear::findOrFail($gearId)->logged_km, 0.01);

        $this->deleteJson("/api/activities/{$actId}")->assertOk();
        $this->assertEqualsWithDelta(0.0, (float) Gear::findOrFail($gearId)->logged_km, 0.01);
    }

    public function test_race_events_and_carb_load_notification(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        $raceDate = now()->addDay()->toDateString();
        $res = $this->postJson('/api/race-events', [
            'title' => 'Manila Half Marathon',
            'activity_type' => 'run',
            'race_date' => $raceDate,
            'distance_km' => 21.1,
            'elevation_gain_m' => 120,
            'goal_time_min' => 115,
            'carb_loading_enabled' => true,
        ])->assertCreated();

        $id = $res->json('data.id');
        $this->getJson('/api/race-events')->assertOk()->assertJsonCount(1, 'data');

        $this->getJson('/api/notifications')
            ->assertOk()
            ->assertJsonFragment(['type' => 'race_carb_load']);

        $this->deleteJson("/api/race-events/{$id}")->assertOk();
    }

    public function test_push_subscription_and_analytics_training_load(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        $this->postJson('/api/push/subscribe', [
            'endpoint' => 'https://push.example/sub/123',
            'preferences' => ['lead_hours' => 4, 'gear_wear_alerts' => true],
        ])->assertCreated()
            ->assertJsonPath('data.subscribed', true)
            ->assertJsonPath('data.preferences.lead_hours', 4);

        $this->putJson('/api/push/preferences', ['lead_hours' => 2])
            ->assertOk()
            ->assertJsonPath('data.preferences.lead_hours', 2);

        $this->artisan('trana:send-fueling-reminders')->assertExitCode(0);

        foreach ([1, 3, 5, 10, 15, 20] as $daysAgo) {
            Activity::create([
                'user_id' => $user->id,
                'activity_type' => 'run',
                'distance_km' => 10,
                'duration_min' => 55,
                'avg_heart_rate' => 152,
                'started_at' => now()->subDays($daysAgo),
            ]);
        }

        $this->getJson('/api/activities/summary')
            ->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'training_load' => ['acute_7d', 'chronic_28d_weekly_avg', 'acwr', 'status', 'recovery_bonus_carbs_pct'],
                    'aerobic_efficiency',
                ],
            ]);

        $this->deleteJson('/api/push/unsubscribe', ['endpoint' => 'https://push.example/sub/123'])
            ->assertOk()
            ->assertJsonPath('subscribed', false);
    }
}
