<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One activity a user finished on a given day, summarised for the route map.
 *
 * Only the fields needed to draw the track and label it are exposed — no
 * notes, gear or heart rate. `route_geojson` is omitted when the activity has
 * no recorded GPS track, so the client can show its "no route" state instead
 * of guessing.
 */
class SessionActivityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'activity_type' => $this->activity_type,
            'distance_km' => (float) $this->distance_km,
            'duration_min' => (float) $this->duration_min,
            'calories' => (int) $this->calories,
            'started_at' => $this->started_at?->toIso8601String(),
            'source' => $this->source,
            'has_route' => $this->route_geojson !== null || is_array($this->route),
            'route_geojson' => $this->route_geojson,
            'route' => $this->route,
        ];
    }
}
