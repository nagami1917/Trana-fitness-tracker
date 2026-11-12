<?php

namespace App\Http\Requests;

use App\Models\Activity;
use App\Services\RouteService;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePredictionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'activity_type' => ['required', Rule::in(Activity::TYPES)],
            'distance_km' => ['required_without:route', 'numeric', 'min:0.1', 'max:500'],
            'elevation_gain_m' => ['nullable', 'integer', 'min:0', 'max:12000'],
            'temperature_c' => ['nullable', 'numeric', 'min:-20', 'max:55'],
            'sweat_profile' => ['nullable', Rule::in(['low', 'normal', 'high'])],
            'planned_for' => ['nullable', 'date', 'after:-1 hour'],
            'route' => ['nullable', 'array', 'min:2', 'max:2000'],
            'route.*' => ['array', 'size:2'],
            'route.*.0' => ['numeric', 'between:-90,90'],
            'route.*.1' => ['numeric', 'between:-180,180'],
            'status' => ['nullable', Rule::in(['planned', 'completed', 'cancelled'])],
        ];
    }

    public function after(RouteService $routes): array
    {
        return [function (Validator $validator) use ($routes) {
            $route = $this->input('route');
            if ($validator->errors()->isNotEmpty() || $route === null) {
                return;
            }

            $distance = $routes->routeLengthKm($route);
            if ($distance < 0.1 || $distance > 500) {
                $validator->errors()->add('route', 'Draw a route between 0.1 and 500 km.');
            }
        }];
    }

    public function messages(): array
    {
        return [
            'distance_km.required_without' => 'Provide a distance or draw a route.',
            'planned_for.after' => 'Choose a planned date and time in the present or future.',
        ];
    }
}
