<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreEnergyExpenditureRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'device_type' => ['required', 'string', 'max:50'],
            'activity_type' => ['required', 'string', 'max:16'],
            'distance_km' => ['required', 'numeric', 'min:0', 'max:500'],
            'duration_min' => ['required', 'numeric', 'min:1', 'max:2880'],
            'avg_heart_rate' => ['nullable', 'integer', 'min:30', 'max:240'],
            'max_heart_rate' => ['nullable', 'integer', 'min:30', 'max:240'],
            'weight_kg' => ['required', 'numeric', 'min:30', 'max:250'],
            'height_cm' => ['nullable', 'numeric', 'min:100', 'max:250'],
            'age' => ['nullable', 'integer', 'min:10', 'max:100'],
            'sex' => ['nullable', 'string', 'max:16'],
            'measured_calories' => ['required', 'numeric', 'min:0', 'max:50000'],
            'recorded_at' => ['required', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'device_type.required' => 'Please specify the wearable device type.',
            'measured_calories.required' => 'Please provide the measured calorie value.',
        ];
    }
}
