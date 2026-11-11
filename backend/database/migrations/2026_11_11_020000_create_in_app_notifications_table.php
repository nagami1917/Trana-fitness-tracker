<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * In-app notification center: reminders synthesized lazily from what the
     * athlete already has (plans for today, goals reached) plus read state.
     *
     * `dedupe_key` is unique per user so synthesizing on every fetch never
     * duplicates a reminder (INSERT … ON CONFLICT DO NOTHING semantics via
     * insertOrIgnore).
     */
    public function up(): void
    {
        Schema::create('in_app_notifications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('type', 40);        // plan_today | goal_reached
            $table->string('dedupe_key', 80);  // e.g. plan:42:2026-11-11
            $table->string('title', 120);
            $table->text('body');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'dedupe_key']);
            $table->index(['user_id', 'read_at']);
        });

        $this->secureDataApi();
    }

    public function down(): void
    {
        Schema::dropIfExists('in_app_notifications');
    }

    /**
     * Reminders are personal — Supabase Data API roles must not read them
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

        DB::statement('alter table public."in_app_notifications" enable row level security');
        DB::statement('revoke all privileges on sequence public."in_app_notifications_id_seq" from "PUBLIC"');
        foreach ($roles as $role) {
            DB::statement("revoke all privileges on table public.\"in_app_notifications\" from {$role}");
            DB::statement("revoke all privileges on sequence public.\"in_app_notifications_id_seq\" from {$role}");
        }
    }
};
