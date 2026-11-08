<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PredictionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // Prediction::toApiArray() owns the exact snake_case/camelCase mix the
        // SPA consumes — keep it as the single source of truth.
        return $this->resource->toApiArray();
    }
}
