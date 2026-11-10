<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Wearable energy-expenditure import and calorie calibration.
 *
 * Devices report what a session really cost; these samples teach the server
 * how far its MET estimate sits from the athlete's device, and new estimates
 * are scaled by that factor once enough samples exist.
 */
class EnergyExpenditureTest extends TestCase
{
    use RefreshDatabase;

    private function athlete(string $email = 'energy@trana.test', float $weightKg = 72): User
    {
        $user = User::create([
            'name' => 'Energy Athlete',
            'email' => $email,
            'password' => 'test-password-123',
        ]);
        $user->ensureProfile()->update(['weight_kg' => $weightKg]);

        return $user;
    }

    /**
     * A device sample: 10 km run in 60 minutes at 72 kg.
     * The MET estimate for that session is 10.3 × 72 = 742 kcal.
     *
     * @return array<string, mixed>
     */
    private function sample(float $measuredCalories, string $recordedAt = '2026-11-08T06:30:00+08:00', ?float $weightKg = null): array
    {
        return [
            'device_type' => 'garmin',
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'avg_heart_rate' => 158,
            'weight_kg' => $weightKg,
            'measured_calories' => $measuredCalories,
            'recorded_at' => $recordedAt,
        ];
    }

    public function test_endpoints_require_authentication(): void
    {
        $this->getJson('/api/energy-expenditure/calibration')->assertUnauthorized();
        $this->getJson('/api/energy-expenditure')->assertUnauthorized();
        $this->postJson('/api/energy-expenditure', ['entries' => []])->assertUnauthorized();
    }

    public function test_import_stores_measurements_and_reports_the_calibration(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        $response = $this->postJson('/api/energy-expenditure', [
            'entries' => [
                $this->sample(800, '2026-11-06T06:30:00+08:00'),
                $this->sample(760, '2026-11-07T06:30:00+08:00'),
            ],
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.imported', 2)
            ->assertJsonPath('data.updated', 0)
            // Two samples: below the minimum, so nothing is calibrated yet.
            ->assertJsonPath('data.calibration.factor', 1.0)
            ->assertJsonPath('data.calibration.applied', false)
            ->assertJsonPath('data.calibration.samples', 2)
            ->assertJsonPath('data.calibration.min_samples', 3);

        $this->assertDatabaseCount('energy_expenditure', 2);
        $this->assertDatabaseHas('energy_expenditure', [
            'user_id' => $user->id,
            'device_type' => 'garmin',
            'activity_type' => 'run',
            'measured_calories' => 800,
        ]);
    }

    public function test_reimporting_the_same_session_updates_instead_of_duplicating(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->postJson('/api/energy-expenditure', ['entries' => [$this->sample(800)]])
            ->assertCreated()
            ->assertJsonPath('data.imported', 1);

        // Same device + recorded_at, corrected calories.
        $this->postJson('/api/energy-expenditure', ['entries' => [$this->sample(820)]])
            ->assertCreated()
            ->assertJsonPath('data.imported', 0)
            ->assertJsonPath('data.updated', 1);

        $this->assertDatabaseCount('energy_expenditure', 1);
        $this->assertDatabaseHas('energy_expenditure', ['measured_calories' => 820]);
    }

    public function test_three_samples_calibrate_new_activity_estimates(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        $this->postJson('/api/energy-expenditure', [
            'entries' => [
                $this->sample(800, '2026-11-06T06:30:00+08:00'),
                $this->sample(800, '2026-11-07T06:30:00+08:00'),
                $this->sample(800, '2026-11-08T06:30:00+08:00'),
            ],
        ])->assertCreated()
            ->assertJsonPath('data.calibration.applied', true)
            ->assertJsonPath('data.calibration.samples', 3)
            // 2400 measured vs 3 × 742 estimated.
            ->assertJsonPath('data.calibration.factor', 1.0782);

        $calibration = $this->getJson('/api/energy-expenditure/calibration')->assertOk()->json('data');
        $this->assertSame(1.0782, $calibration['factor']);
        $this->assertSame(3, $calibration['samples']);
        $this->assertSame(2400, $calibration['measured_calories']);
        $this->assertSame(2226, $calibration['estimated_calories']);

        // A new activity logged via the map gets the calibrated estimate:
        // 742 × 1.0782 ≈ 800 kcal.
        $activity = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'started_at' => '2026-11-09T06:30:00+08:00',
        ])->assertCreated()->json('data');

        $this->assertSame(800, $activity['calories']);
        $this->assertDatabaseHas('activities', ['id' => $activity['id'], 'calories' => 800]);

        // …and the stats screen reads the calibrated value.
        $this->getJson('/api/activities/summary')
            ->assertOk()
            ->assertJsonPath('data.totals.calories', 800);
    }

    public function test_the_calibration_factor_is_clamped(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->postJson('/api/energy-expenditure', [
            'entries' => [
                $this->sample(2400, '2026-11-06T06:30:00+08:00'),
                $this->sample(2400, '2026-11-07T06:30:00+08:00'),
                $this->sample(2400, '2026-11-08T06:30:00+08:00'),
            ],
        ])->assertCreated()
            // 3.23× raw, clamped to the 2.0× ceiling.
            ->assertJsonPath('data.calibration.factor', 2.0)
            ->assertJsonPath('data.calibration.raw_factor', 3.2345);

        $activity = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'started_at' => '2026-11-09T06:30:00+08:00',
        ])->assertCreated()->json('data');

        $this->assertSame(1484, $activity['calories']); // 742 × 2.0
    }

    public function test_a_low_calibration_factor_is_clamped_too(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->postJson('/api/energy-expenditure', [
            'entries' => [
                $this->sample(120, '2026-11-06T06:30:00+08:00'),
                $this->sample(120, '2026-11-07T06:30:00+08:00'),
                $this->sample(120, '2026-11-08T06:30:00+08:00'),
            ],
        ])->assertCreated()->assertJsonPath('data.calibration.factor', 0.5);

        $activity = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'started_at' => '2026-11-09T06:30:00+08:00',
        ])->assertCreated()->json('data');

        $this->assertSame(371, $activity['calories']); // 742 × 0.5
    }

    public function test_calibration_also_applies_to_supplied_calories(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->postJson('/api/energy-expenditure', [
            'entries' => [
                $this->sample(800, '2026-11-06T06:30:00+08:00'),
                $this->sample(800, '2026-11-07T06:30:00+08:00'),
                $this->sample(800, '2026-11-08T06:30:00+08:00'),
            ],
        ])->assertCreated();

        // The map and the manual form both send their own estimate; the
        // athlete's calibration factor still applies to what gets stored.
        $activity = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'calories' => 812,
            'started_at' => '2026-11-09T06:30:00+08:00',
        ])->assertCreated()->json('data');

        $this->assertSame(875, $activity['calories']); // round(812 × 1.0782)
    }

    public function test_samples_use_their_own_recorded_weight_for_the_estimate(): void
    {
        $user = $this->athlete(); // profile: 72 kg
        Sanctum::actingAs($user);

        // Each sample carries 80 kg, so the estimate uses 80, not 72:
        // 10.3 × 80 = 824 kcal per session.
        $this->postJson('/api/energy-expenditure', [
            'entries' => [
                $this->sample(900, '2026-11-06T06:30:00+08:00', 80),
                $this->sample(900, '2026-11-07T06:30:00+08:00', 80),
                $this->sample(900, '2026-11-08T06:30:00+08:00', 80),
            ],
        ])->assertCreated()
            ->assertJsonPath('data.calibration.estimated_calories', 2472)
            ->assertJsonPath('data.calibration.factor', 1.0922); // 2700 / 2472
    }

    public function test_import_validates_every_entry(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->postJson('/api/energy-expenditure', ['entries' => []])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('entries');

        $this->postJson('/api/energy-expenditure', [
            'entries' => [
                ['device_type' => 'fitbit', 'activity_type' => 'run', 'distance_km' => 10, 'duration_min' => 60, 'measured_calories' => 800, 'recorded_at' => '2026-11-08T06:30:00+08:00'],
                ['device_type' => 'garmin', 'activity_type' => 'swim', 'distance_km' => 10, 'duration_min' => 60, 'measured_calories' => 800, 'recorded_at' => '2026-11-08T06:30:00+08:00'],
                ['device_type' => 'garmin', 'activity_type' => 'run', 'distance_km' => 10, 'duration_min' => 60, 'measured_calories' => 800, 'recorded_at' => '2099-01-01T00:00:00+00:00'],
            ],
        ])->assertUnprocessable()
            ->assertJsonValidationErrors([
                'entries.0.device_type',
                'entries.1.activity_type',
                'entries.2.recorded_at',
            ]);

        $this->assertDatabaseCount('energy_expenditure', 0);
    }

    public function test_samples_can_be_listed_and_filtered_by_device(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->postJson('/api/energy-expenditure', [
            'entries' => [
                $this->sample(800, '2026-11-06T06:30:00+08:00'),
                array_merge($this->sample(760, '2026-11-07T06:30:00+08:00'), ['device_type' => 'strava']),
            ],
        ])->assertCreated();

        $this->getJson('/api/energy-expenditure')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.device_type', 'strava') // newest first
            ->assertJsonPath('calibration.samples', 2);

        $this->getJson('/api/energy-expenditure?device=garmin')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.device_type', 'garmin');
    }

    public function test_another_athletes_samples_stay_private(): void
    {
        $owner = $this->athlete('owner@trana.test');
        Sanctum::actingAs($owner);
        $this->postJson('/api/energy-expenditure', ['entries' => [$this->sample(800)]])->assertCreated();

        Sanctum::actingAs($this->athlete('stranger@trana.test'));

        $this->getJson('/api/energy-expenditure')
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('calibration.samples', 0)
            ->assertJsonPath('calibration.applied', false);
    }
}
