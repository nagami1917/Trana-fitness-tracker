<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // --- athlete profile -------------------------------------------------
        Schema::create('fitness_profiles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->decimal('weight_kg', 5, 2);
            $table->decimal('height_cm', 5, 1)->nullable();
            $table->smallInteger('birth_year')->nullable();
            $table->string('sex', 16)->default('other');
            $table->string('sweat_profile', 16)->default('normal');
            $table->unsignedTinyInteger('experience_level')->default(1);
            $table->decimal('typical_temperature_c', 4, 1)->default(26);
            $table->string('city')->nullable();
            $table->string('units', 10)->default('metric');
            $table->timestampTz('onboarded_at')->nullable();
            $table->timestamps();
        });

        // --- historical activities (the training data) ----------------------
        Schema::create('activities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('activity_type', 16);
            $table->decimal('distance_km', 8, 3);
            $table->unsignedInteger('elevation_gain_m')->default(0);
            $table->decimal('duration_min', 8, 2);
            $table->unsignedInteger('calories')->nullable();
            $table->unsignedSmallInteger('avg_heart_rate')->nullable();
            $table->timestampTz('started_at');
            $table->jsonb('route')->nullable();
            $table->text('notes')->nullable();
            $table->string('source', 24)->default('manual');
            $table->timestamps();

            $table->index(['user_id', 'started_at']);
            $table->index(['user_id', 'activity_type']);
        });

        // --- saved predictions ----------------------------------------------
        Schema::create('predictions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('activity_type', 16);
            $table->decimal('distance_km', 8, 3);
            $table->unsignedInteger('elevation_gain_m')->default(0);
            $table->jsonb('route')->nullable();
            $table->timestampTz('planned_for')->nullable();
            $table->string('status', 16)->default('planned');

            $table->decimal('duration_min', 8, 2);
            $table->decimal('duration_low_min', 8, 2);
            $table->decimal('duration_high_min', 8, 2);
            $table->decimal('confidence', 4, 3)->default(0.8);

            $table->unsignedInteger('calories')->default(0);
            $table->unsignedSmallInteger('carbs_per_hour_g')->default(0);
            $table->unsignedInteger('carbs_total_g')->default(0);
            $table->unsignedInteger('sodium_per_hour_mg')->default(0);
            $table->unsignedInteger('fluid_per_hour_ml')->default(0);
            $table->string('intensity', 20)->default('moderate');
            $table->decimal('met', 5, 2)->nullable();

            $table->jsonb('payload')->nullable();
            $table->string('model_version', 40)->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });

        // --- goals ------------------------------------------------------------
        Schema::create('goals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->unsignedInteger('daily_calories')->default(2400);
            $table->decimal('daily_distance_km', 6, 2)->default(10);
            $table->unsignedSmallInteger('daily_active_min')->default(60);
            $table->unsignedInteger('weekly_calories')->default(12000);
            $table->decimal('weekly_distance_km', 7, 2)->default(40);
            $table->unsignedSmallInteger('carb_target_g')->default(360);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('goals');
        Schema::dropIfExists('predictions');
        Schema::dropIfExists('activities');
        Schema::dropIfExists('fitness_profiles');
    }
};
