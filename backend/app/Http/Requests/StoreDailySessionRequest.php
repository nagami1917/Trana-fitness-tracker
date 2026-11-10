<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreDailySessionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'calories_burned' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'calories_eaten' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'water_ml' => ['nullable', 'integer', 'min:0', 'max:20000'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
