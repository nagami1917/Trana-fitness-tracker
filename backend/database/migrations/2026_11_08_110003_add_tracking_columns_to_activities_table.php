<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Extend activities with live-tracking fields so a GPS-recorded session can
     * be stored alongside manually entered activities without duplicating data.
     */
    public function up(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            $table->timestampTz('ended_at')->nullable()->after('started_at');
            $table->decimal('average_speed', 6, 2)->nullable()->after('duration_min'); // km/h
            $table->decimal('average_pace', 6, 2)->nullable()->after('average_speed'); // min/km
            $table->jsonb('route_geojson')->nullable()->after('route');
        });
    }

    public function down(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            $table->dropColumn(['ended_at', 'average_speed', 'average_pace', 'route_geojson']);
        });
    }
};
