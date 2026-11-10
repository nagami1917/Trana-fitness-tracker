<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDailySessionFoodRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'meal_type' => ['required', 'string', 'in:breakfast,lunch,dinner,snack'],
            'food_name' => ['required', 'string', 'max:120'],
            'calories' => ['required', 'integer', 'min:0', 'max:50000'],
            'carbs_g' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'protein_g' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'fat_g' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'quantity' => ['nullable', 'integer', 'min:1', 'max:100'],
            'notes' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'meal_type.required' => 'Please select a meal type.',
            'meal_type.in' => 'Meal type must be breakfast, lunch, dinner, or snack.',
            'food_name.required' => 'Please enter the food name.',
            'calories.required' => 'Please enter calories.',
        ];
    }
}
