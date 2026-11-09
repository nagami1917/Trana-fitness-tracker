<?php

namespace App\Http\Requests;

use App\Models\Activity;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreActivityRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'activity_type' => ['required', Rule::in(Activity::TYPES)],
            'distance_km' => ['required', 'numeric', 'min:0.05', 'max:500'],
            'duration_min' => ['required', 'numeric', 'min:1', 'max:2880'],
            'elevation_gain_m' => ['nullable', 'integer', 'min:0', 'max:12000'],
            'calories' => ['nullable', 'integer', 'min:0', 'max:20000'],
            'avg_heart_rate' => ['nullable', 'integer', 'min:30', 'max:240'],
            'started_at' => ['required', 'date', 'before_or_equal:now'],
            'ended_at' => ['nullable', 'date', 'after_or_equal:started_at'],
            'route' => ['nullable', 'array', 'max:2000'],
            'route.*' => ['array', 'size:2'],
            'route.*.0' => ['numeric', 'between:-90,90'],
            'route.*.1' => ['numeric', 'between:-180,180'],
            'route_geojson' => ['nullable', 'array'],
            'average_speed' => ['nullable', 'numeric', 'min:0', 'max:300'],
            'average_pace' => ['nullable', 'numeric', 'min:0', 'max:1440'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'source' => ['nullable', 'string', 'max:24'],
        ];
    }

    /**
     * Validate route_geojson as a usable GeoJSON object when provided.
     */
    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $geojson = $this->input('route_geojson');
            if ($geojson === null) {
                return;
            }

            if (! is_array($geojson) || ! isset($geojson['type'])) {
                $validator->errors()->add('route_geojson', 'The route must be a GeoJSON object.');
                return;
            }

            $coordinates = $this->collectCoordinates($geojson);
            if ($coordinates === []) {
                $validator->errors()->add('route_geojson', 'The route GeoJSON contains no coordinates.');
            }
        }];
    }

    public function messages(): array
    {
        return [
            'distance_km.min' => 'Distance must be at least 0.05 km.',
            'duration_min.min' => 'Duration must be at least 1 minute.',
            'ended_at.after_or_equal' => 'End time must be after start time.',
        ];
    }

    /**
     * Walk a GeoJSON object and collect every [lon, lat] coordinate pair.
     */
    private function collectCoordinates(array $geojson): array
    {
        $out = [];

        $walk = function (array &$geometry) use (&$walk, &$out) {
            if (! isset($geometry['type'], $geometry['coordinates'])) {
                return;
            }

            match ($geometry['type']) {
                'Point' => $out[] = $geometry['coordinates'],
                'LineString' => array_walk($geometry['coordinates'], fn ($coord) => $out[] = $coord),
                'MultiLineString' => array_walk($geometry['coordinates'], fn ($line) => array_walk($line, fn ($coord) => $out[] = $coord)),
                default => null,
            };
        };

        if ((string) ($geojson['type'] ?? '') === 'FeatureCollection') {
            foreach ($geojson['features'] ?? [] as $feature) {
                $walk($feature['geometry'] ?? []);
            }
        } elseif ((string) ($geojson['type'] ?? '') === 'Feature') {
            $walk($geojson['geometry'] ?? []);
        } else {
            $walk($geojson);
        }

        return $out;
    }
}
