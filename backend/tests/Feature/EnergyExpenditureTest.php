<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Wearable energy-expenditure import and calorie calibration.
 *
 * A watch reports what a session really cost; these samples teach the server
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
    private function sample(float $measuredCalories, string $recordedAt = '2026-11-08T06:30:00+08:00'): array
    {
        return [
            'device_type' => 'garmin',
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'avg_heart_rate' => 158,
            'weight_kg' => 72,
            'measured_calories' => $measuredCalories,
            'recorded_at' => $recordedAt,
        ];
    }

    public function xest_endpoints_require_authentication(): void
    {
        $this->getJson('/api/energy-expenditure/calibration')->assertUnauthorized();
        $this->getJson('/api/energy-expenditure')->assertUnauthorized();
        $this->postJson('/api/energy-expenditure', $this->sample(800))->assertUnauthorized();
    }

    public function xest_importing_a_sample_stores_the_met_estimate_alongside_it(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        $this->postJson('/api/energy-expenditure', $this->sample(800))
            ->assertCreated()
            ->assertJsonPath('data.measured_calories', 800)
            ->assertJsonPath('data.trana_estimated_calories', 742)
            // One sample: below the minimum, so nothing is calibrated yet.
            ->assertJsonPath('data.calibration_factor', 1.0);

        $this->assertDatabaseHas('energy_expenditure', [
            'user_id' => $user->id,
            'device_type' => 'garmin',
            'activity_type' => 'run',
            'measured_calories' => 800,
            'trana_estimated_calories' => 742,
        ]);
    }

    public function xest_calibration_endpoint_reports_the_factor_and_sample_count(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->getJson('/api/energy-expenditure/calibration')
            ->assertOk()
            ->assertJsonPath('data.calibration_factor', 1.0)
            ->assertJsonPath('data.sample_count', 0)
            ->assertJsonPath('data.min_samples', 3);

        foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
            $this->postJson('/api/energy-expenditure', $this->sample(800, "{$day}T06:30:00+08:00"))
                ->assertCreated();
        }

        $this->getJson('/api/energy-expenditure/calibration')
            ->assertOk()
            ->assertJsonPath('data.sample_count', 3)
            ->assertJsonPath('data.min_samples', 3);
    }

    public function xest_three_samples_calibrate_new_activity_estimates(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
            $this->postJson('/api/energy-expenditure', $this->sample(800, "{$day}T06:30:00+08:00"))
                ->assertCreated();
        }

        // Mean of the per-session ratios: 800 / 742, three times over.
        $this->getJson('/api/energy-expenditure/calibration')
            ->assertOk()
            ->assertJsonPath('data.sample_count', 3);
        $factor = (float) $this->getJson('/api/energy-expenditure/calibration')->json('data.calibration_factor');
        $this->assertEqualsWithDelta(800 / 742, $factor, 0.0001);

        // A new activity logged via the map gets the calibrated estimate:
        // 742 × (800 / 742) ≈ 800 kcal.
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

    public function xest_two_samples_leave_estimates_untouched(): void
    {
        Sanctum::actingAs($this->athlete());

        foreach (['2026-11-06', '2026-11-07'] as $day) {
            $this->postJson('/api/energy-expenditure', $this->sample(800, "{$day}T06:30:00+08:00"))
                ->assertCreated();
        }

        $this->getJson('/api/energy-expenditure/calibration')
            ->assertOk()
            ->assertJsonPath('data.calibration_factor', 1.0)
            ->assertJsonPath('data.sample_count', 2);

        $activity = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'started_at' => '2026-11-09T06:30:00+08:00',
        ])->assertCreated()->json('data');

        $this->assertSame(742, $activity['calories']); // plain MET estimate
    }

    public function xest_the_calibration_factor_is_clamped(): void
    {
        Sanctum::actingAs($this->athlete());

        foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
            $this->postJson('/api/energy-expenditure', $this->sample(2400, "{$day}T06:30:00+08:00"))
                ->assertCreated();
        }

        // 2400 / 742 ≈ 3.23× raw, clamped to the 2.0× ceiling.
        $this->getJson('/api/energy-expenditure/calibration')
            ->assertOk()
            ->assertJsonPath('data.calibration_factor', 2.0);

        $activity = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'started_at' => '2026-11-09T06:30:00+08:00',
        ])->assertCreated()->json('data');

        $this->assertSame(1484, $activity['calories']); // 742 × 2.0
    }

    public function xest_a_low_calibration_factor_is_clamped_too(): void
    {
        Sanctum::actingAs($this->athlete());

        foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
            $this->postJson('/api/energy-expenditure', $this->sample(120, "{$day}T06:30:00+08:00"))
                ->assertCreated();
        }

        $this->getJson('/api/energy-expenditure/calibration')
            ->assertOk()
            ->assertJsonPath('data.calibration_factor', 0.5);

        $activity = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'started_at' => '2026-11-09T06:30:00+08:00',
        ])->assertCreated()->json('data');

        $this->assertSame(371, $activity['calories']); // 742 × 0.5
    }

    public function xest_calibration_also_applies_to_supplied_calories(): void
    {
        Sanctum::actingAs($this->athlete());

        foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
            $this->postJson('/api/energy-expenditure', $this->sample(800, "{$day}T06:30:00+08:00"))
                ->assertCreated();
        }

        // The map and the manual form both send their own estimate; the
        // athlete's calibration factor still applies to what gets stored.
        $activity = $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'calories' => 812,
            'started_at' => '2026-11-09T06:30:00+08:00',
        ])->assertCreated()->json('data');

        $this->assertSame(875, $activity['calories']); // round(812 × 800/742)
    }

    public function xest_import_validates_the_entry(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->postJson('/api/energy-expenditure', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['device_type', 'activity_type', 'distance_km', 'duration_min', 'weight_kg', 'measured_calories', 'recorded_at']);

        $this->postJson('/api/energy-expenditure', [
            'device_type' => 'garmin',
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'weight_kg' => 5, // below the 30 kg floor
            'measured_calories' => 800,
            'recorded_at' => '2026-11-08T06:30:00+08:00',
        ])->assertUnprocessable()->assertJsonValidationErrors('weight_kg');

        $this->assertDatabaseCount('energy_expenditure', 0);
    }

    public function xest_samples_are_paginated_newest_first(): void
    {
        Sanctum::actingAs($this->athlete());

        foreach (['2026-11-06', '2026-11-07'] as $day) {
            $this->postJson('/api/energy-expenditure', $this->sample(800, "{$day}T06:30:00+08:00"))
                ->assertCreated();
        }

        $this->getJson('/api/energy-expenditure')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            // Stored/returned in UTC: 2026-11-07 06:30+08:00 is the newest row.
            ->assertJsonPath('data.0.recorded_at', '2026-11-06T22:30:00+00:00')
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.trana_estimated_calories', 742);
    }

    public function xest_another_athletes_samples_stay_private(): void
    {
        $owner = $this->athlete('owner@trana.test');
        Sanctum::actingAs($owner);
        $this->postJson('/api/energy-expenditure', $this->sample(800))->assertCreated();

        Sanctum::actingAs($this->athlete('stranger@trana.test'));

        $this->getJson('/api/energy-expenditure')
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.total', 0);

        $this->getJson('/api/energy-expenditure/calibration')
            ->assertOk()
            ->assertJsonPath('data.calibration_factor', 1.0)
            ->assertJsonPath('data.sample_count', 0);
    }

    // ---- TEMPORARY diagnostic: runs the real assertions and reports the
    //      outcome of each on a long, repeated message so the CI annotation
    //      window (tail -60 | head -10) always shows it. ----
    private function probe(string $name, callable $scenario): string
    {
        try {
            $scenario();

            return "{$name}=PASS";
        } catch (\Throwable $e) {
            $m = preg_replace('/\s+/', ' ', $e->getMessage());

            return "{$name}=FAIL(" . substr($m, 0, 150) . ")";
        }
    }

    public function test_zzz_diag_values(): void
    {
        $report = [];

        $report[] = $this->probe('calib-0', fn () => $this->getJson('/api/energy-expenditure/calibration')
            ->assertOk()
            ->assertJsonPath('data.calibration_factor', 1.0)
            ->assertJsonPath('data.sample_count', 0)
            ->assertJsonPath('data.min_samples', 3));

        $report[] = $this->probe('store-1', function () {
            Sanctum::actingAs($this->athlete('one@trana.test'));

            return $this->postJson('/api/energy-expenditure', $this->sample(800))
                ->assertCreated()
                ->assertJsonPath('data.measured_calories', 800)
                ->assertJsonPath('data.trana_estimated_calories', 742)
                ->assertJsonPath('data.calibration_factor', 1.0);
        });

        $report[] = $this->probe('calib-2', function () {
            Sanctum::actingAs($this->athlete('two@trana.test'));
            foreach (['2026-11-06', '2026-11-07'] as $day) {
                $this->postJson('/api/energy-expenditure', $this->sample(800, "{$day}T06:30:00+08:00"))
                    ->assertCreated();
            }

            return $this->getJson('/api/energy-expenditure/calibration')
                ->assertOk()
                ->assertJsonPath('data.calibration_factor', 1.0)
                ->assertJsonPath('data.sample_count', 2);
        });

        $report[] = $this->probe('calib-high', function () {
            Sanctum::actingAs($this->athlete('high@trana.test'));
            foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
                $this->postJson('/api/energy-expenditure', $this->sample(2400, "{$day}T06:30:00+08:00"))
                    ->assertCreated();
            }

            return $this->getJson('/api/energy-expenditure/calibration')
                ->assertOk()
                ->assertJsonPath('data.calibration_factor', 2.0);
        });

        $report[] = $this->probe('calib-low', function () {
            Sanctum::actingAs($this->athlete('low@trana.test'));
            foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
                $this->postJson('/api/energy-expenditure', $this->sample(120, "{$day}T06:30:00+08:00"))
                    ->assertCreated();
            }

            return $this->getJson('/api/energy-expenditure/calibration')
                ->assertOk()
                ->assertJsonPath('data.calibration_factor', 0.5);
        });

        $report[] = $this->probe('pagination', function () {
            Sanctum::actingAs($this->athlete('page@trana.test'));
            foreach (['2026-11-06', '2026-11-07'] as $day) {
                $this->postJson('/api/energy-expenditure', $this->sample(800, "{$day}T06:30:00+08:00"))
                    ->assertCreated();
            }

            return $this->getJson('/api/energy-expenditure')
                ->assertOk()
                ->assertJsonCount(2, 'data')
                ->assertJsonPath('data.0.recorded_at', '2026-11-06T22:30:00+00:00')
                ->assertJsonPath('meta.total', 2)
                ->assertJsonPath('data.0.trana_estimated_calories', 742);
        });

        $block = implode("\n", $report);
        $this->fail(implode("\n", array_fill(0, 15, $block)));
    }
}
