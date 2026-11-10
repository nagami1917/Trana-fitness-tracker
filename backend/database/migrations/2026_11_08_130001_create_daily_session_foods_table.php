<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Food items logged within a daily session.
     * Meal type: breakfast, lunch, dinner, or snack.
     * No predefined dataset — user enters any food freely.
     */
    public function up(): void
    {
        Schema::create('daily_session_foods', function (Blueprint $table) {
            $table->id();
            $table->foreignId('daily_session_id')->constrained('daily_sessions')->cascadeOnDelete();
            $table->string('meal_type'); // breakfast, lunch, dinner, snack
            $table->string('food_name'); // user-entered, no dataset required
            $table->unsignedInteger('calories')->default(0);
            $table->unsignedInteger('carbs_g')->default(0);
            $table->unsignedInteger('protein_g')->default(0);
            $table->unsignedInteger('fat_g')->default(0);
            $table->unsignedInteger('quantity')->default(1); // servings
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['daily_session_id', 'meal_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('daily_session_foods');
    }
};
