<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Every moment an activity goal is reached — one row per (activity, goal).
     *
     * Rows are written by App\Services\GoalEventRecorder the moment a saved
     * activity pushes a daily/weekly total across its target. The Goals page
     * groups them by `date` so a day with 3 achievements shows as
     * "Nov 11, 2026 — 3 achievements" with achieved/target values.
     *
     * Deleting the activity cascades away its achievements (mirrors the
     * activity delete endpoint's own cascade semantics).
     */
    public function up(): void
    {
        Schema::create('goal_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('activity_id')->constrained('activities')->cascadeOnDelete();
            $table->date('date');                       // activity's local calendar day (window start)
            $table->string('goal_key', 32);             // daily_calories | daily_distance_km | daily_active_min | weekly_calories | weekly_distance_km
            $table->decimal('target', 10, 2);
            $table->decimal('achieved_value', 10, 2);   // window total at the moment the target was crossed
            $table->timestamps();

            $table->index(['user_id', 'date']);
        });

        $this->secureDataApi();
    }

    public function down(): void
    {
        Schema::dropIfExists('goal_events');
    }

    /**
     * Laravel owns authentication; Supabase's Data API roles must not write
     * achievements (mirrors 2026_11_08_120000 for energy_expenditure).
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

        DB::statement('alter table public."goal_events" enable row level security');
        DB::statement('revoke all privileges on sequence public."goal_events_id_seq" from "PUBLIC"');
        foreach ($roles as $role) {
            DB::statement("revoke all privileges on table public.\"goal_events\" from {$role}");
            DB::statement("revoke all privileges on sequence public.\"goal_events_id_seq\" from {$role}");
        }
    }
};
