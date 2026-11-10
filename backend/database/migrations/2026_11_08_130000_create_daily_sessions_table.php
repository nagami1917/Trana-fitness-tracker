<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Daily training/nutrition sessions.
     * One row per day per user, reset at midnight local time.
     * Tracks calories burned (from activity map) vs calories eaten (from food log).
     */
    public function up(): void
    {
        Schema::create('daily_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->date('session_date');
            $table->unsignedInteger('calories_burned')->default(0); // from activity tracking
            $table->unsignedInteger('calories_eaten')->default(0);  // from food log
            $table->unsignedInteger('water_ml')->default(0);
            $table->text('notes')->nullable();
            $table->timestamps();

            // One session per day *per athlete* — the composite below, not a
            // unique index on session_date alone (which would let only one
            // user in the whole system log a session on a given date).
            $table->index(['user_id', 'session_date']);
            $table->unique(['user_id', 'session_date'], 'daily_sessions_user_date_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('daily_sessions');
    }
};
