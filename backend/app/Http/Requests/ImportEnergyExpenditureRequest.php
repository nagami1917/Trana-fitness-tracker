<?php

namespace App\Http\Requests;

use App\Models\Activity;
use App\Models\EnergyExpenditure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Batch import of wearable energy-expenditure measurements.
 *
 * Accepts `{ "entries": [ … ] }` with the same field names the CSV export
 * uses; see docs/api.md.
 */
class ImportEnergyExpenditureRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'entries' => ['required', 'array', 'min:1', 'max:500'],
            'entries.*.device_type' => ['required', Rule::in(EnergyExpenditure::DEVICE_TYPES)],
            'entries.*.activity_type' => ['required', Rule::in(Activity::TYPES)],
            'entries.*.distance_km' => ['required', 'numeric', 'min:0.05', 'max:500'],
            'entries.*.duration_min' => ['required', 'numeric', 'min:1', 'max:2880'],
            'entries.*.avg_heart_rate' => ['nullable', 'integer', 'min:30', 'max:240'],
            'entries.*.weight_kg' => ['nullable', 'numeric', 'min:25', 'max:250'],
            'entries.*.measured_calories' => ['required', 'integer', 'min:1', 'max:20000'],
            'entries.*.recorded_at' => ['required', 'date', 'before_or_equal:now'],
        ];
    }

    public function messages(): array
    {
        return [
            'entries.required' => 'Send at least one measurement in "entries".',
            'entries.max' => 'Import at most 500 measurements at a time.',
            'entries.*.device_type.in' => 'Unsupported device. Use one of: '.implode(', ', EnergyExpenditure::DEVICE_TYPES).'.',
            'entries.*.activity_type.in' => 'Unsupported activity. Use one of: '.implode(', ', Activity::TYPES).'.',
            'entries.*.measured_calories.required' => 'Each measurement needs the calories the device reported.',
            'entries.*.recorded_at.before_or_equal' => 'Measurements cannot be recorded in the future.',
        ];
    }
}
