<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Spec-compatible compatibility VIEWS.
 *
 * The original product spec names the persistence layer as users /
 * user_profiles / activities / planned_activities / nutritional_predictions
 * (+ optional activity_routes / user_goals / prediction_history). TRANA ships
 * the richer real schema (fitness_profiles, predictions with an embedded
 * fueling block, goals). These views expose the spec's names read-only —
 * nothing is duplicated, writes keep flowing through the app as before.
 *
 * Defined with plain ANSI selects (no jsonb operators) so the same SQL works
 * on PostgreSQL (create or replace) and SQLite (create … if not exists).
 */
return new class extends Migration
{
    public function up(): void
    {
        $views = [
            'user_profiles' => '
                select id, user_id, weight_kg, height_cm, birth_year, sex,
                       sweat_profile, experience_level, typical_temperature_c,
                       city, units, onboarded_at, created_at, updated_at
                from fitness_profiles',

            'planned_activities' => '
                select id, user_id, activity_type, distance_km, elevation_gain_m,
                       route, planned_for, status,
                       duration_min, duration_low_min, duration_high_min,
                       confidence, payload, model_version, created_at, updated_at
                from predictions',

            'nutritional_predictions' => '
                select id as prediction_id, user_id, activity_type, planned_for,
                       calories, carbs_per_hour_g, carbs_total_g,
                       sodium_per_hour_mg, fluid_per_hour_ml,
                       intensity, met, created_at
                from predictions',

            'activity_routes' => '
                select id as activity_id, user_id, distance_km, elevation_gain_m,
                       started_at, route
                from activities
                where route is not null',

            'user_goals' => '
                select id, user_id, daily_calories, daily_distance_km, daily_active_min,
                       weekly_calories, weekly_distance_km, carb_target_g,
                       created_at, updated_at
                from goals',

            'prediction_history' => '
                select id, user_id, activity_type, planned_for, status,
                       model_version, created_at, updated_at
                from predictions
                order by created_at desc',
        ];

        foreach ($views as $name => $select) {
            $this->createView($name, $select);
        }
    }

    public function down(): void
    {
        foreach (['user_profiles', 'planned_activities', 'nutritional_predictions', 'activity_routes', 'user_goals', 'prediction_history'] as $name) {
            DB::statement("DROP VIEW IF EXISTS {$name}");
        }
    }

    private function createView(string $name, string $select): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("CREATE OR REPLACE VIEW {$name} AS {$select}");
        } else {
            DB::statement("CREATE VIEW IF NOT EXISTS {$name} AS {$select}");
        }
    }
};
