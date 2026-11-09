<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreActivityPointRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'altitude' => ['nullable', 'numeric', 'between:-1000,9000'],
            'speed' => ['nullable', 'numeric', 'min:0', 'max:300'], // km/h
            'accuracy' => ['nullable', 'integer', 'min:0', 'max:10000'], // metres
            'timestamp' => ['required', 'date'],
        ];
    }

    public function messages(): array
    {
        return [
            'latitude.between' => 'Latitude must be between -90 and 90.',
            'longitude.between' => 'Longitude must be between -180 and 180.',
            'speed.max' => 'The reported speed is unrealistic for a fitness activity.',
        ];
    }
}
