<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Spec step 4 — user fitness profile.
 *
 * `fitness_profiles` stays the single writable table (predictions, goals and the
 * ML payload all read it). The spec-facing `user_profiles` projection is brought
 * to the exact field list the product spec asks for:
 *
 *   id · user_id · age · sex · height_cm · weight_kg ·
 *   fitness_level · activity_experience · created_at · updated_at
 *
 * Mapping decisions:
 *   age                 derived from birth_year (always correct, nothing to sync)
 *   fitness_level       the existing 1–5 experience_level
 *   activity_experience years of consistent training — a new nullable column
 *
 * `fitness_level_source` records who owns the level: 'auto' (the activity-count
 * heuristic in ActivityService) or 'user' (the athlete set it explicitly in
 * Step 4's endpoints). Without it, logging a session would silently revert a
 * fitness level the athlete just chose.
 *
 * Writes continue to go through the Laravel API; `user_profiles` is read-only.
 * Dropping and recreating the view also drops the security_invoker flag and the
 * Data API revokes applied by 2026_11_08_000002, so they are re-applied here.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('fitness_profiles', 'activity_experience')) {
            Schema::table('fitness_profiles', function (Blueprint $table) {
                $table->decimal('activity_experience', 4, 1)->nullable();
            });
        }

        if (! Schema::hasColumn('fitness_profiles', 'fitness_level_source')) {
            Schema::table('fitness_profiles', function (Blueprint $table) {
                $table->string('fitness_level_source', 8)->default('auto');
            });
        }

        $this->replaceView($this->specView());
    }

    public function down(): void
    {
        $this->replaceView($this->legacyView());

        foreach (['fitness_level_source', 'activity_experience'] as $column) {
            if (Schema::hasColumn('fitness_profiles', $column)) {
                Schema::table('fitness_profiles', function (Blueprint $table) use ($column) {
                    $table->dropColumn($column);
                });
            }
        }
    }

    /** The Step 4 spec's ten columns, in the spec's order. */
    private function specView(): string
    {
        $year = $this->currentYearExpression();

        return "
            select
                id,
                user_id,
                case when birth_year is null then null else {$year} - birth_year end as age,
                sex,
                height_cm,
                weight_kg,
                experience_level as fitness_level,
                activity_experience,
                created_at,
                updated_at
            from fitness_profiles";
    }

    /** The pre-Step-4 projection, restored on rollback. */
    private function legacyView(): string
    {
        return '
            select id, user_id, weight_kg, height_cm, birth_year, sex,
                   sweat_profile, experience_level, typical_temperature_c,
                   city, units, onboarded_at, created_at, updated_at
            from fitness_profiles';
    }

    /**
     * A view cannot rename/reorder existing columns, and the SQLite and
     * PostgreSQL year functions differ, so build the expression per driver.
     */
    private function currentYearExpression(): string
    {
        return match (DB::getDriverName()) {
            'sqlite' => "cast(strftime('%Y', 'now') as integer)",
            'mysql', 'mariadb' => 'year(curdate())',
            default => 'cast(extract(year from current_date) as integer)',
        };
    }

    private function replaceView(string $select): void
    {
        DB::statement('DROP VIEW IF EXISTS user_profiles');
        DB::statement("CREATE VIEW user_profiles AS {$select}");

        $this->protectView();
    }

    /** Keep the read-only projection unreachable from the Supabase Data API. */
    private function protectView(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $version = (int) DB::selectOne('show server_version_num')->server_version_num;
        if ($version >= 150000) {
            DB::statement('alter view public."user_profiles" set (security_invoker = true)');
        }

        $roles = ['PUBLIC'];
        foreach (DB::select("select rolname from pg_roles where rolname in ('anon', 'authenticated')") as $role) {
            // Role names come from the fixed allowlist above, never from input.
            $roles[] = '"'.$role->rolname.'"';
        }

        foreach ($roles as $role) {
            DB::statement("revoke all privileges on table public.\"user_profiles\" from {$role}");
        }
    }
};
