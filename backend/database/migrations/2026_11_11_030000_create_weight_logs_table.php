<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Body-metrics timeline: one weigh-in per athlete per day. Re-logging a
     * date replaces that day's value (unique key), and the newest weigh-in
     * stays mirrored into fitness_profiles.weight_kg for ML predictions.
     */
    public function up(): void
    {
        Schema::create('weight_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->decimal('weight_kg', 5, 2);
            $table->date('measured_at');
            $table->timestamps();

            $table->unique(['user_id', 'measured_at']);
        });

        $this->secureDataApi();
    }

    public function down(): void
    {
        Schema::dropIfExists('weight_logs');
    }

    /**
     * Body data is personal — Supabase Data API roles must not read it
     * (mirrors 2026_11_08_120000). No-op on SQLite tests.
     */
    private function secureDataApi(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $roles = ['PUBLIC'];
        foreach (DB::select("select rolname from pg_roles where rolname in ('anon', 'authenticated')") as $role) {
            $roles[] = '"'.$role->rolname.'"';
        }

        DB::statement('alter table public."weight_logs" enable row level security');
        DB::statement('revoke all privileges on sequence public."weight_logs_id_seq" from "PUBLIC"');
        foreach ($roles as $role) {
            DB::statement("revoke all privileges on table public.\"weight_logs\" from {$role}");
            DB::statement("revoke all privileges on sequence public.\"weight_logs_id_seq\" from {$role}");
        }
    }
};
