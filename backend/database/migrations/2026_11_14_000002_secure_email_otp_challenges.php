<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** OTP challenge hashes are private Laravel data, never Supabase Data API data. */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('alter table public."email_otp_challenges" enable row level security');

        $roles = ['PUBLIC'];
        foreach (DB::select("select rolname from pg_roles where rolname in ('anon', 'authenticated')") as $role) {
            // Role names come from the fixed allowlist above, not request data.
            $roles[] = '"'.$role->rolname.'"';
        }

        foreach ($roles as $role) {
            DB::statement('revoke all privileges on table public."email_otp_challenges" from '.$role);
            DB::statement('revoke all privileges on sequence public."email_otp_challenges_id_seq" from '.$role);
        }
    }

    public function down(): void
    {
        // Deliberately keep RLS and revoked Data API access in place on rollback.
    }
};
