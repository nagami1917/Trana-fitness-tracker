<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class EnergyExpenditureResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'device_type' => $this->device_type,
            'activity_type' => $this->activity_type,
            'distance_km' => (float) $this->distance_km,
            'duration_min' => (float) $this->duration_min,
            'avg_heart_rate' => $this->avg_heart_rate,
            'weight_kg' => $this->weight_kg === null ? null : (float) $this->weight_kg,
            'measured_calories' => (int) $this->measured_calories,
            'recorded_at' => $this->recorded_at?->toIso8601String(),
        ];
    }
}
