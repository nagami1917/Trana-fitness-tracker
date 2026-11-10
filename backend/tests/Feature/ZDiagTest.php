<?php

namespace Tests\Feature;

use App\Models\EnergyExpenditure;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/** TEMPORARY diagnostic — reports why the calibration query fails in CI. */
class ZDiagTest extends TestCase
{
    use RefreshDatabase;

    public function test_calibration_query(): void
    {
        $report = [];

        $report[] = 'hasTable=' . var_export(Schema::hasTable('energy_expenditure'), true);

        if (Schema::hasTable('energy_expenditure')) {
            $report[] = 'cols=' . implode(',', Schema::getColumnListing('energy_expenditure'));
        }

        $report[] = 'migrations=' . implode(',', Schema::hasTable('migrations')
            ? \Illuminate\Support\Facades\DB::table('migrations')->pluck('migration')->all()
            : ['no-migrations-table']);

        $user = User::create([
            'name' => 'Diag',
            'email' => 'diag@trana.test',
            'password' => 'password-123',
        ]);

        try {
            $rows = EnergyExpenditure::forUser($user->id)
                ->withMeasured()
                ->whereNotNull('trana_estimated_calories')
                ->get();

            $report[] = 'queryOK count=' . $rows->count();
        } catch (\Throwable $e) {
            $report[] = 'EX ' . get_class($e) . ' :: ' . $e->getMessage();
        }

        $this->fail('DIAGREPORT ' . implode(' | ', $report));
    }
}
