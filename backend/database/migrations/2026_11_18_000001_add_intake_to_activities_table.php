<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Track records what the athlete actually consumed during a session, but it was
 * only ever written into the free-text `notes` column as
 * "Intake during session: 750 ml fluid, 90 g carbs". That is readable by a
 * human and useless to a model: nothing can compute "you took 55 g/h last time"
 * from a sentence without parsing English.
 *
 * These columns store the same figures as numbers so the fueling suggestion can
 * be compared against what the athlete really did. They are nullable: an older
 * row, or a session where nothing was logged, has no intake to compare with and
 * must not be treated as "ate nothing".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            $table->unsignedInteger('fluid_ml')->nullable()->after('notes');
            $table->unsignedInteger('carbs_g')->nullable()->after('fluid_ml');
            $table->unsignedInteger('sodium_mg')->nullable()->after('carbs_g');
        });
    }

    public function down(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            $table->dropColumn(['fluid_ml', 'carbs_g', 'sodium_mg']);
        });
    }
};
