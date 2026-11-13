<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ActivityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'activity_type' => $this->activity_type,
            'distance_km' => (float) $this->distance_km,
            'elevation_gain_m' => (int) $this->elevation_gain_m,
            'duration_min' => (float) $this->duration_min,
            'calories' => (int) $this->calories,
            'avg_heart_rate' => $this->avg_heart_rate,
            'started_at' => $this->started_at?->toIso8601String(),
            'ended_at' => $this->ended_at?->toIso8601String(),
            'average_speed' => $this->average_speed ? (float) $this->average_speed : null,
            'average_pace' => $this->average_pace ? (float) $this->average_pace : null,
            'route' => $this->route,
            'route_geojson' => $this->when(
                array_key_exists('route_geojson', $this->resource->getAttributes()),
                fn () => $this->route_geojson
            ),
            'gear_id' => $this->gear_id,
            'notes' => $this->notes,
            'source' => $this->source,
        ];
    }
}
