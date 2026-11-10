<?php

namespace Tests\Feature;

use App\Models\DailySession;
use App\Models\EnergyExpenditure;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Regression cover for the three defects repaired while merging PR #18.
 *
 * Each one was silent in production and cheap to guard, so the guards live
 * together here with a note on what each protects.
 */
class CalibrationRegressionTest extends TestCase
{
    use RefreshDatabase;

    private function athlete(string $email, float $weightKg = 72): User
    {
        $user = User::create([
            'name' => 'Regression Athlete',
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
    private function sample(float $measuredCalories, string $recordedAt): array
    {
        return [
            'device_type' => 'garmin',
            'activity_type' => 'run',
            'distance_km' => 10,
            'duration_min' => 60,
            'weight_kg' => 72,
            'measured_calories' => $measuredCalories,
            'recorded_at' => $recordedAt,
        ];
    }

    /**
     * @param  array<string, mixed>  $sample
     */
    private function importSample(array $sample): void
    {
        $this->postJson('/api/energy-expenditure', $sample)->assertCreated();
    }

    /**
     * Assert the calibration endpoint reports a float of the expected value.
     *
     * assertJsonPath() already compares with assertSame(), so an integer 1
     * against a float 1.0 fails on its own — but the decoded-type and raw-body
     * checks below name the serialisation requirement outright, so a future
     * regression reports "expected a float" rather than "1 is not identical
     * to 1.0".
     */
    private function assertFactorIs(float $expected): void
    {
        $response = $this->getJson('/api/energy-expenditure/calibration')->assertOk();

        $actual = $response->json('data.calibration_factor');

        $this->assertIsFloat(
            $actual,
            sprintf('calibration_factor must decode to a float, got %s.', get_debug_type($actual))
        );

        $this->assertEqualsWithDelta($expected, $actual, 0.0001);

        // PHP's json_encode drops the fraction on a whole-number float unless
        // the response is encoded with JSON_PRESERVE_ZERO_FRACTION. That is
        // exactly the shape the factor takes at 1.0 and at the 2.0 ceiling.
        if ($expected === floor($expected)) {
            $this->assertStringContainsString(
                '"calibration_factor":' . $expected . '.0',
                $response->getContent(),
                'calibration_factor must keep its decimal point in the raw JSON body.'
            );
        }
    }

    public function test_the_model_reads_the_singular_energy_expenditure_table(): void
    {
        // Eloquent derives "energy_expenditures" from this class name unless
        // $table says otherwise, and every calibration query died with
        // "no such table" against it.
        $this->assertSame('energy_expenditure', (new EnergyExpenditure)->getTable());
    }

    public function test_calibration_counts_the_samples_stored_in_that_table(): void
    {
        $user = $this->athlete('counts@trana.test');
        Sanctum::actingAs($user);

        foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
            $this->importSample($this->sample(800, "{$day}T06:30:00+00:00"));
        }

        $this->assertSame(
            3,
            EnergyExpenditure::forUser($user->id)->withMeasured()->count()
        );

        $this->getJson('/api/energy-expenditure/calibration')
            ->assertOk()
            ->assertJsonPath('data.sample_count', 3)
            ->assertJsonPath('data.min_samples', 3);
    }

    public function test_the_factor_stays_a_float_while_below_the_minimum(): void
    {
        $user = $this->athlete('below-minimum@trana.test');
        Sanctum::actingAs($user);

        // No samples at all: the factor is exactly 1.0.
        $this->assertFactorIs(1.0);

        // One sample, still short of the three-sample minimum.
        $this->importSample($this->sample(800, '2026-11-06T06:30:00+00:00'));
        $this->assertFactorIs(1.0);

        // Two samples, still short.
        $this->importSample($this->sample(800, '2026-11-07T06:30:00+00:00'));
        $this->assertFactorIs(1.0);

        // Three samples of 800 kcal against a 742 kcal estimate gives a
        // genuinely fractional factor, which was never affected by the bug.
        $this->importSample($this->sample(800, '2026-11-08T06:30:00+00:00'));
        $this->assertFactorIs(800 / 742);
    }

    public function test_the_clamped_ceiling_is_a_float_two(): void
    {
        $user = $this->athlete('ceiling@trana.test');
        Sanctum::actingAs($user);

        foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
            $this->importSample($this->sample(2400, "{$day}T06:30:00+00:00"));
        }

        // 2400 / 742 ≈ 3.23, clamped to the 2.0 ceiling.
        $this->assertFactorIs(2.0);
    }

    public function test_the_clamped_floor_is_a_float_half(): void
    {
        $user = $this->athlete('floor@trana.test');
        Sanctum::actingAs($user);

        foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
            $this->importSample($this->sample(120, "{$day}T06:30:00+00:00"));
        }

        // 120 / 742 ≈ 0.16, clamped to the 0.5 floor.
        $this->assertFactorIs(0.5);
    }

    public function test_each_athlete_owns_one_session_per_date(): void
    {
        $alice = $this->athlete('alice@trana.test');
        $bob = $this->athlete('bob@trana.test');

        // A single-column unique on session_date would have allowed only one
        // athlete in the whole system to log a session on any given date.
        DailySession::create([
            'user_id' => $alice->id,
            'session_date' => '2026-11-07',
            'calories_burned' => 500,
            'calories_eaten' => 1800,
        ]);
        DailySession::create([
            'user_id' => $bob->id,
            'session_date' => '2026-11-07',
            'calories_burned' => 300,
            'calories_eaten' => 2100,
        ]);

        $aliceSession = DailySession::where('user_id', $alice->id)->sole();
        $bobSession = DailySession::where('user_id', $bob->id)->sole();

        // Both athletes hold a session on the same date. Read the value back
        // through the model's date cast rather than the raw column, so the
        // assertion does not depend on how the driver stores it.
        $this->assertSame('2026-11-07', $aliceSession->session_date->toDateString());
        $this->assertSame('2026-11-07', $bobSession->session_date->toDateString());
        $this->assertSame(2, DailySession::count());

        // …while one athlete still cannot open a second session on that date.
        $this->expectException(QueryException::class);

        DailySession::create([
            'user_id' => $alice->id,
            'session_date' => '2026-11-07',
            'calories_burned' => 100,
        ]);
    }
}
