<?php

namespace Tests\Feature;

use App\Models\EnergyExpenditure;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** TEMPORARY diagnostic — reports actual calibration values. */
class ADiagTest extends TestCase
{
    use RefreshDatabase;

    public function test_diag(): void
    {
        $user = User::create([
            'name' => 'Diag Athlete',
            'email' => 'adiag@trana.test',
            'password' => 'test-password-123',
        ]);
        $user->ensureProfile()->update(['weight_kg' => 72]);
        Sanctum::actingAs($user);

        foreach (['2026-11-06', '2026-11-07'] as $day) {
            $this->postJson('/api/energy-expenditure', [
                'device_type' => 'garmin',
                'activity_type' => 'run',
                'distance_km' => 10,
                'duration_min' => 60,
                'weight_kg' => 72,
                'measured_calories' => 800,
                'recorded_at' => "{$day}T06:30:00+08:00",
            ])->assertCreated();
        }

        $rows = DB::table('energy_expenditure')->get();
        $info = [];
        $info[] = 'rowcount=' . $rows->count();
        foreach ($rows as $r) {
            $info[] = "row(id={$r->id},user={$r->user_id},measured={$r->measured_calories},est={$r->trana_estimated_calories},at={$r->recorded_at})";
        }

        $info[] = 'scope_count=' . EnergyExpenditure::forUser($user->id)->withMeasured()->count();
        $info[] = 'scope_est_count=' . EnergyExpenditure::forUser($user->id)->withMeasured()->whereNotNull('trana_estimated_calories')->count();

        $response = $this->getJson('/api/energy-expenditure/calibration');
        $info[] = 'status=' . $response->status();
        $info[] = 'body=' . $response->getContent();

        $this->fail('DIAGVALS ' . implode(' | ', $info));
    }
}
