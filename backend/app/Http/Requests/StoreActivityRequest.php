<?php

namespace App\Http\Requests;

use App\Models\Activity;
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
            'route' => ['nullable', 'array', 'max:2000'],
            'route.*' => ['array', 'size:2'],
            'route.*.0' => ['numeric', 'between:-90,90'],
            'route.*.1' => ['numeric', 'between:-180,180'],
            'route_geojson' => ['nullable', 'array'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'source' => ['nullable', 'string', 'max:24'],
        ];
    }
}
