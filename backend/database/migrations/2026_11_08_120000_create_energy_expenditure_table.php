<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Wearable-measured energy expenditure data (e.g. WEEE dataset).
     * Used to calibrate TRANA's MET-based calorie estimates against real
     * sensor data from heart rate and physiological devices.
     */
    public function up(): void
    {
        Schema::create('energy_expenditure', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('device_type', 50); // e.g. 'garmin', 'apple_watch', 'fitbit', 'polar'
            $table->string('activity_type', 16);
            $table->decimal('distance_km', 8, 3);
            $table->decimal('duration_min', 8, 2);
            $table->unsignedSmallInteger('avg_heart_rate')->nullable();
            $table->unsignedSmallInteger('max_heart_rate')->nullable();
            $table->decimal('weight_kg', 5, 2);
            $table->decimal('height_cm', 5, 1)->nullable();
            $table->unsignedSmallInteger('age')->nullable();
            $table->string('sex', 16)->nullable();
            $table->decimal('measured_calories', 8, 2); // wearable-measured energy expenditure
            $table->unsignedInteger('trana_estimated_calories')->nullable(); // TRANA's MET estimate
            $table->timestampTz('recorded_at');
            $table->timestamps();

            $table->index(['user_id', 'recorded_at']);
            $table->index('user_id');
        });

        $this->secureDataApi();
    }

    public function down(): void
    {
        Schema::dropIfExists('energy_expenditure');
    }

    /**
     * Laravel owns authentication; Supabase's Data API roles must not read an
     * athlete's samples (mirrors 2026_11_08_000002 for the earlier tables).
     * No-op on SQLite tests.
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
