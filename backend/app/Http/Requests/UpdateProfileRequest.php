<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:80'],
            'weight_kg' => ['sometimes', 'numeric', 'min:25', 'max:250'],
            'height_cm' => ['sometimes', 'nullable', 'numeric', 'min:100', 'max:250'],
            'birth_year' => ['sometimes', 'nullable', 'integer', 'min:1930', 'max:'.(int) date('Y')],
            'sex' => ['sometimes', Rule::in(['female', 'male', 'other'])],
            'sweat_profile' => ['sometimes', Rule::in(['low', 'normal', 'high'])],
            'experience_level' => ['sometimes', 'integer', 'min:1', 'max:5'],
            'typical_temperature_c' => ['sometimes', 'numeric', 'min:-10', 'max:50'],
            'city' => ['sometimes', 'nullable', 'string', 'max:120'],
            'units' => ['sometimes', Rule::in(['metric', 'imperial'])],
            'daily_calorie_goal' => ['sometimes', 'integer', 'min:800', 'max:8000'],
            'daily_distance_goal_km' => ['sometimes', 'numeric', 'min:1', 'max:300'],
            'daily_active_min_goal' => ['sometimes', 'integer', 'min:5', 'max:600'],
            'weekly_calorie_goal' => ['sometimes', 'integer', 'min:1000', 'max:40000'],
            'weekly_distance_goal_km' => ['sometimes', 'numeric', 'min:1', 'max:1500'],
            'daily_carb_goal_g' => ['sometimes', 'integer', 'min:50', 'max:1200'],
            'onboarded' => ['sometimes', 'boolean'],
        ];
    }
}
