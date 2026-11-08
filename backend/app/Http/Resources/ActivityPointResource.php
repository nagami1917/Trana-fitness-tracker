<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ActivityPointResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'latitude' => (float) $this->latitude,
            'longitude' => (float) $this->longitude,
            'altitude' => $this->altitude ? (float) $this->altitude : null,
            'speed' => $this->speed ? (float) $this->speed : null,
            'accuracy' => $this->accuracy,
            'timestamp' => $this->timestamp?->toIso8601String(),
        ];
    }
}
