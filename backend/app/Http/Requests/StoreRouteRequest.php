<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class StoreRouteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'distance_km' => ['required', 'numeric', 'min:0.05', 'max:500'],
            'estimated_duration_min' => ['required', 'numeric', 'min:1', 'max:2880'],
            'elevation_gain_m' => ['nullable', 'integer', 'min:0', 'max:12000'],
            'route_geojson' => ['nullable', 'array'],
        ];
    }

    /**
     * Reject route_geojson unless it is a usable GeoJSON geometry with
     * coordinates the map can render.
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
            'name.required' => 'Give your route a name.',
            'distance_km.min' => 'A route must be at least 0.05 km.',
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
