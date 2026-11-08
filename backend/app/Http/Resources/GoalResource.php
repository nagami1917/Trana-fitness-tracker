<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class GoalResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'daily_calories' => $this->daily_calories,
            'daily_distance_km' => (float) $this->daily_distance_km,
            'daily_active_min' => $this->daily_active_min,
            'weekly_calories' => $this->weekly_calories,
            'weekly_distance_km' => (float) $this->weekly_distance_km,
            'carb_target_g' => $this->carb_target_g,
        ];
    }
}
