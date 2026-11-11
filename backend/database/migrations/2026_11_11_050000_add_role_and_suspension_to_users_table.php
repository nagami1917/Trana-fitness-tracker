<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Admin console (Tier 1): role foundation + suspension flag.
     *
     * Roles are deliberately plain strings with an application-level
     * allowlist (User::ROLE_*) — every admin route is gated server-side by
     * the `admin` middleware, never by anything the client sends.
     * Suspension blocks login and every authenticated request; the flag is
     * additive so existing accounts keep working as athletes.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 16)->default('athlete');
            $table->timestamp('suspended_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['role', 'suspended_at']);
        });
    }
};
