<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DailySessionFoodResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'meal_type' => $this->meal_type,
            'food_name' => $this->food_name,
            'calories' => (int) $this->calories,
            'carbs_g' => (int) $this->carbs_g,
            'protein_g' => (int) $this->protein_g,
            'fat_g' => (int) $this->fat_g,
            'quantity' => (int) $this->quantity,
            'notes' => $this->notes,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
