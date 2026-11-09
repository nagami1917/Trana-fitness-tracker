<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\MapsProfileFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/profile — create the athlete's fitness profile.
 *
 * Body mass is the only required value (the fueling math cannot run without
 * it). Everything else is optional and falls back to the column defaults.
 */
class StoreProfileRequest extends FormRequest
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
        return $this->profileFieldRules(creating: true) + [
            'name' => ['sometimes', 'string', 'max:80'],
            'onboarded' => ['sometimes', 'boolean'],
        ];
    }
}
