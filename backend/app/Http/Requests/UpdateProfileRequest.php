<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\MapsProfileFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PUT|PATCH /api/profile — edit any part of the profile (plus the athlete's
 * name and goal targets, which the profile screen edits together).
 */
class UpdateProfileRequest extends FormRequest
{
    use MapsProfileFields;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->mapProfileFieldAliases();
    }

    public function rules(): array
    {
        return $this->profileFieldRules() + [
            'name' => ['sometimes', 'string', 'max:80'],
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
