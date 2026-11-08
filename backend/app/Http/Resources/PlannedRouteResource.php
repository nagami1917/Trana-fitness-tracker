<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PlannedRouteResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'distance_km' => (float) $this->distance_km,
            'estimated_duration_min' => (float) $this->estimated_duration_min,
            'elevation_gain_m' => (int) $this->elevation_gain_m,
            'route_geojson' => $this->route_geojson,
            'points' => $this->whenLoaded('routePoints', function () {
                return $this->routePoints->map(fn ($point) => [
                    'latitude' => (float) $point->latitude,
                    'longitude' => (float) $point->longitude,
                    'altitude' => $point->altitude ? (float) $point->altitude : null,
                    'sequence' => (int) $point->sequence,
                ]);
            }),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
