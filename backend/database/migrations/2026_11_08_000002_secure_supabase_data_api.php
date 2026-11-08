<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Laravel owns authentication; Supabase's anonymous and authenticated Data API
 * roles must not be able to bypass it. SQLite tests have no RLS/Data API.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $tables = [
            'migrations', 'users', 'sessions', 'cache', 'cache_locks', 'jobs',
            'failed_jobs', 'fitness_profiles', 'activities', 'predictions', 'goals',
            'personal_access_tokens',
        ];
        $views = [
            'user_profiles', 'planned_activities', 'nutritional_predictions',
            'activity_routes', 'user_goals', 'prediction_history',
            // These optional analytical views are installed by the SQL baseline.
            'v_athlete_pace', 'v_daily_totals', 'v_prediction_accuracy',
        ];
        $sequences = [
            'migrations_id_seq', 'users_id_seq', 'jobs_id_seq', 'failed_jobs_id_seq',
            'fitness_profiles_id_seq', 'activities_id_seq', 'predictions_id_seq',
            'goals_id_seq', 'personal_access_tokens_id_seq',
        ];

        $roles = ['PUBLIC'];
        foreach (DB::select("select rolname from pg_roles where rolname in ('anon', 'authenticated')") as $role) {
            // Both names come from the fixed allowlist above, not from user input.
            $roles[] = '"'.$role->rolname.'"';
        }

        foreach ($tables as $table) {
            if ($this->exists($table)) {
                DB::statement("alter table public.\"{$table}\" enable row level security");
            }
        }

        // Postgres 15+ can apply the caller's RLS to a view. Revoking Data API
        // access below remains the primary protection on older Postgres versions.
        $version = (int) DB::selectOne('show server_version_num')->server_version_num;
        foreach ($views as $view) {
            if ($version >= 150000 && $this->exists($view)) {
                DB::statement("alter view public.\"{$view}\" set (security_invoker = true)");
            }
        }

        foreach (array_merge($tables, $views) as $relation) {
            if (! $this->exists($relation)) {
                continue;
            }
            foreach ($roles as $role) {
                DB::statement("revoke all privileges on table public.\"{$relation}\" from {$role}");
            }
        }
        foreach ($sequences as $sequence) {
            if (! $this->exists($sequence)) {
                continue;
            }
            foreach ($roles as $role) {
                DB::statement("revoke all privileges on sequence public.\"{$sequence}\" from {$role}");
            }
        }
    }

    public function down(): void
    {
        // Deliberately do not remove RLS or re-grant browser access on rollback.
    }

    private function exists(string $name): bool
    {
        $result = DB::selectOne('select case when to_regclass(?) is null then 0 else 1 end as present', ['public.'.$name]);

        return (int) $result->present === 1;
    }
};
