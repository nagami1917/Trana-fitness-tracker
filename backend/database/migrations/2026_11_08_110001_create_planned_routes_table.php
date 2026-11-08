<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Planned routes an athlete can draw ahead of a session.
     * The route geometry is stored as GeoJSON in route_geojson.
     */
    public function up(): void
    {
        Schema::create('planned_routes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('name');
            $table->decimal('distance_km', 8, 3);
            $table->decimal('estimated_duration_min', 8, 2);
            $table->unsignedInteger('elevation_gain_m')->default(0);
            $table->jsonb('route_geojson')->nullable(); // GeoJSON LineString / FeatureCollection
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('planned_routes');
    }
};
