<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('password')->nullable()->change();
        });

        Schema::create('email_otp_challenges', function (Blueprint $table) {
            $table->id();
            $table->string('email')->unique();
            $table->string('name', 80)->nullable();
            $table->string('purpose', 24);
            $table->char('code_hash', 64);
            $table->timestamp('expires_at')->index();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->unsignedTinyInteger('send_count')->default(1);
            $table->timestamp('send_window_started_at');
            $table->timestamp('last_sent_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_otp_challenges');

        // Keep users.password nullable: passwordless accounts cannot be given
        // a recoverable password during rollback.
    }
};
