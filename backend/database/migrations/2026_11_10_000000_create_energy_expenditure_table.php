<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Wearable energy-expenditure samples used to calibrate TRANA's MET
     * calorie estimates.
     *
     * One row per device-reported session: what the watch measured, kept so
     * the calibration service can compare it against the server-side MET
     * estimate for the same session.
     */
    public function up(): void
    {
        Schema::create('energy_expenditure', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('device_type', 32);
            $table->string('activity_type', 16);
            $table->decimal('distance_km', 8, 3);
            $table->decimal('duration_min', 8, 2);
            $table->unsignedSmallInteger('avg_heart_rate')->nullable();
            $table->decimal('weight_kg', 5, 2)->nullable();
            $table->unsignedInteger('measured_calories');
            $table->timestampTz('recorded_at');
            $table->timestamps();

            // Re-importing the same device session updates the row instead of
            // duplicating it, keeping the calibration ratio stable.
            $table->unique(['user_id', 'device_type', 'recorded_at']);
            $table->index(['user_id', 'activity_type']);
        });

        $this->secureDataApi();
    }

    public function down(): void
    {
        Schema::dropIfExists('energy_expenditure');
    }

    /**
     * Laravel owns authentication; Supabase's Data API roles must not read an
     * athlete's calibration samples (mirrors 2026_11_08_000002 for the tables
     * that existed then). No-op on SQLite tests.
     */
    private function secureDataApi(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $roles = ['PUBLIC'];
        foreach (DB::select("select rolname from pg_roles where rolname in ('anon', 'authenticated')") as $role) {
            // Both names come from the fixed allowlist above, not from user input.
            $roles[] = '"'.$role->rolname.'"';
        }

        DB::statement('alter table public."energy_expenditure" enable row level security');
        DB::statement('revoke all privileges on sequence public."energy_expenditure_id_seq" from "PUBLIC"');
        foreach ($roles as $role) {
            DB::statement("revoke all privileges on table public.\"energy_expenditure\" from {$role}");
            DB::statement("revoke all privileges on sequence public.\"energy_expenditure_id_seq\" from {$role}");
        }
    }
};
