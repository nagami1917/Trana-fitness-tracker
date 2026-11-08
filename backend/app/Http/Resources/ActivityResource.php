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
            'route' => $this->route,
            'notes' => $this->notes,
            'source' => $this->source,
        ];
    }
}
