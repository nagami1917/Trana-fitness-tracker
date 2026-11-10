<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DailySessionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'session_date' => $this->session_date,
            'calories_burned' => (int) $this->calories_burned,
            'calories_eaten' => (int) $this->calories_eaten,
            'water_ml' => (int) $this->water_ml,
            'net_calories' => (int) $this->net_calories,
            'surplus_deficit' => $this->surplus_deficit,
            'notes' => $this->notes,
            'foods' => DailySessionFoodResource::collection($this->whenLoaded('foods'))->toArray($request),
            'foods_count' => $this->whenLoaded('foods', $this->foods->count()),
            'total_food_calories' => $this->whenLoaded('foods', $this->foods->sum('calories')),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
