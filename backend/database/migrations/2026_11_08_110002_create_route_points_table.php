<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Ordered vertices of a planned route, denormalised from route_geojson so
     * the map can render them without re-parsing the JSON on every request.
     */
    public function up(): void
    {
        Schema::create('route_points', function (Blueprint $table) {
            $table->id();
            $table->foreignId('route_id')->constrained('planned_routes')->cascadeOnDelete();
            $table->decimal('latitude', 10, 7);
            $table->decimal('longitude', 11, 7);
            $table->decimal('altitude', 7, 2)->nullable();
            $table->unsignedInteger('sequence');
            $table->timestamps();

            $table->unique(['route_id', 'sequence']);
            $table->index(['route_id', 'sequence']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('route_points');
    }
};
