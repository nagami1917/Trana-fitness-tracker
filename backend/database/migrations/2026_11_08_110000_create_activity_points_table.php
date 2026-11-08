<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Raw GPS samples recorded while an activity is tracked.
     *
     * One row per watchPosition sample: latitude, longitude, optional
     * altitude/speed from the device, and the GPS timestamp.
     */
    public function up(): void
    {
        Schema::create('activity_points', function (Blueprint $table) {
            $table->id();
            $table->foreignId('activity_id')->constrained('activities')->cascadeOnDelete();
            $table->decimal('latitude', 10, 7);
            $table->decimal('longitude', 11, 7);
            $table->decimal('altitude', 7, 2)->nullable(); // metres above sea level
            $table->decimal('speed', 6, 2)->nullable();     // km/h, from the device
            $table->unsignedSmallInteger('accuracy')->nullable(); // metres, device-reported
            $table->timestampTz('timestamp');              // when the device recorded it
            $table->timestamps();

            $table->index(['activity_id', 'timestamp']);
            $table->index('timestamp');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_points');
    }
};
