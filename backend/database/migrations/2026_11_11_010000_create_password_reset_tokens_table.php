<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Laravel password broker storage (missing from the slim 0001 users
     * migration). One row per email: hashed reset token + issue time.
     */
    public function up(): void
    {
        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });

        $this->secureDataApi();
    }

    public function down(): void
    {
        Schema::dropIfExists('password_reset_tokens');
    }

    /**
     * Reset tokens are credentials — Supabase Data API roles must not read
     * them (mirrors 2026_11_08_120000). No-op on SQLite tests.
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

        DB::statement('alter table public."password_reset_tokens" enable row level security');
        foreach ($roles as $role) {
            DB::statement("revoke all privileges on table public.\"password_reset_tokens\" from {$role}");
        }
    }
};
