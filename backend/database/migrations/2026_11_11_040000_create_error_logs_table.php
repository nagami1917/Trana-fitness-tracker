<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Error-monitoring store: one row per fingerprinted fault (server
     * exceptions, browser client errors, ML-service errors) with an
     * occurrence counter — the raw material for the admin viewer.
     *
     * Traces can contain request details, so the table is locked down on
     * the Supabase Data API (mirrors weight_logs / energy tables).
     */
    public function up(): void
    {
        Schema::create('error_logs', function (Blueprint $table) {
            $table->id();
            // Kept even if the account is deleted (nullable FK, no cascade):
            // production incidents outlive the user who triggered them.
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('kind', 16);          // api | client | ml
            $table->string('level', 16)->default('error');
            $table->string('fingerprint', 64);   // sha1 grouping key
            $table->text('message');
            $table->string('exception_class', 191)->nullable();
            $table->string('route', 200)->nullable();
            $table->string('method', 10)->nullable();
            $table->unsignedInteger('occurrences')->default(1);
            $table->json('context')->nullable(); // user agent, app version …
            $table->text('trace')->nullable();   // first frames, capped
            $table->string('status', 16)->default('open'); // open|acknowledged|resolved
            $table->timestamp('first_seen_at')->useCurrent();
            $table->timestamp('last_seen_at')->useCurrent();
            $table->timestamps();

            $table->unique(['kind', 'fingerprint']);
            $table->index(['status', 'last_seen_at']);
        });

        $this->secureDataApi();
    }

    public function down(): void
    {
        Schema::dropIfExists('error_logs');
    }

    /**
     * Error traces are private — Supabase Data API roles must not read them
     * (same treatment as 2026_11_11_030000). No-op on SQLite tests.
     */
    private function secureDataApi(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $roles = ['PUBLIC'];
        foreach (DB::select("select rolname from pg_roles where rolname in ('anon', 'authenticated')") as $role) {
            $roles[] = '"' . $role->rolname . '"';
        }

        DB::statement('alter table public."error_logs" enable row level security');
        DB::statement('revoke all privileges on sequence public."error_logs_id_seq" from "PUBLIC"');
        foreach ($roles as $role) {
            DB::statement("revoke all privileges on table public.\"error_logs\" from {$role}");
            DB::statement("revoke all privileges on sequence public.\"error_logs_id_seq\" from {$role}");
        }
    }
};
