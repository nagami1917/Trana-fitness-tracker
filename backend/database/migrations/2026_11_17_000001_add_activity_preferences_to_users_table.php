<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Onboarding captured body metrics, a training preset and sweat profile, but
 * never asked which activities the athlete actually does. That choice changes
 * what the planner should default to and lets the dashboard lead with the
 * sports the athlete picked.
 *
 * Stored as a JSON list of Activity::TYPES values. Null means "never asked",
 * which is distinct from an empty list ("asked, uses everything"), so the
 * onboarding gate can tell an old account from a deliberately broad one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fitness_profiles', function (Blueprint $table) {
            $table->jsonb('preferred_activities')->nullable()->after('units');
        });

        Schema::table('activities', function (Blueprint $table) {
            // A baseline row is a remembered past session, entered once during
            // onboarding so the duration model can anchor to the athlete's own
            // pace. It is training history for the model but not a session the
            // athlete logged here, so it is excluded from the dashboard totals.
            $table->boolean('is_baseline')->default(false)->after('source');
            $table->index(['user_id', 'is_baseline']);
        });
    }

    public function down(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'is_baseline']);
            $table->dropColumn('is_baseline');
        });

        Schema::table('fitness_profiles', function (Blueprint $table) {
            $table->dropColumn('preferred_activities');
        });
    }
};
