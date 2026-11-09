<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** PATCH /api/profile/weight — the single value the fueling math reads. */
class UpdateWeightRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'weight_kg' => ['required', 'numeric', 'min:25', 'max:250'],
        ];
    }

    public function messages(): array
    {
        return [
            'weight_kg.required' => 'Send weight_kg (for example {"weight_kg": 62.5}).',
        ];
    }
}
