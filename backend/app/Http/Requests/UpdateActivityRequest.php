<?php

namespace App\Http\Requests;

use App\Models\Activity;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateActivityRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'activity_type' => ['sometimes', 'required', Rule::in(Activity::TYPES)],
            'distance_km' => ['sometimes', 'required', 'numeric', 'min:0.05', 'max:500'],
            'duration_min' => ['sometimes', 'required', 'numeric', 'min:1', 'max:2880'],
            'elevation_gain_m' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:12000'],
            'calories' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:20000'],
            'avg_heart_rate' => ['sometimes', 'nullable', 'integer', 'min:30', 'max:240'],
            'started_at' => ['sometimes', 'required', 'date', 'before_or_equal:now'],
            'ended_at' => ['sometimes', 'nullable', 'date'],
            'route' => ['sometimes', 'nullable', 'array', 'max:2000'],
            'route.*' => ['array', 'size:2'],
            'route.*.0' => ['numeric', 'between:-90,90'],
            'route.*.1' => ['numeric', 'between:-180,180'],
            'route_geojson' => ['sometimes', 'nullable', 'array'],
            'average_speed' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:300'],
            'average_pace' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:1440'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $endedAt = $this->input('ended_at');
            if ($endedAt !== null) {
                $startedRaw = $this->input('started_at') ?? $this->route('activity')?->started_at;
                if ($startedRaw && \Illuminate\Support\Carbon::parse($endedAt)->lt(\Illuminate\Support\Carbon::parse($startedRaw))) {
                    $validator->errors()->add('ended_at', 'End time must be after start time.');
                }
            }

            $geojson = $this->input('route_geojson');
            if ($geojson === null) {
                return;
            }

            if (! is_array($geojson) || ! isset($geojson['type'])) {
                $validator->errors()->add('route_geojson', 'The route must be a GeoJSON object.');
                return;
            }

            if ($this->collectCoordinates($geojson) === []) {
                $validator->errors()->add('route_geojson', 'The route GeoJSON contains no coordinates.');
            }
        }];
    }

    public function messages(): array
    {
        return [
            'distance_km.min' => 'Distance must be at least 0.05 km.',
            'duration_min.min' => 'Duration must be at least 1 minute.',
        ];
    }

    private function collectCoordinates(array $geojson): array
    {
        $out = [];

        $walk = function (array $geometry) use (&$out) {
            if (! isset($geometry['type'], $geometry['coordinates']) || ! is_array($geometry['coordinates'])) {
                return;
            }

            if ($geometry['type'] === 'Point') {
                $out[] = $geometry['coordinates'];
            } elseif ($geometry['type'] === 'LineString') {
                foreach ($geometry['coordinates'] as $coord) {
                    $out[] = $coord;
                }
            } elseif ($geometry['type'] === 'MultiLineString') {
                foreach ($geometry['coordinates'] as $line) {
                    if (! is_array($line)) {
                        continue;
                    }
                    foreach ($line as $coord) {
                        $out[] = $coord;
                    }
                }
            }
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
