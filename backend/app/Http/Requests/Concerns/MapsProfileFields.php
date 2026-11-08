<?php

namespace App\Http\Requests\Concerns;

/**
 * Accepts the Step 4 spec's field names as aliases for the stored columns, so
 * clients can speak either vocabulary:
 *
 *   age        → birth_year  (the profile stores the year, age is derived)
 *   fitness_level → experience_level (the existing 1–5 model feature)
 */
trait MapsProfileFields
{
    protected function mapProfileFieldAliases(): void
    {
        $merge = [];

        if ($this->has('fitness_level') && ! $this->has('experience_level')) {
            $merge['experience_level'] = $this->input('fitness_level');
        }

        if ($this->has('age') && ! $this->has('birth_year')) {
            $age = $this->input('age');

            if ($age === null || $age === '') {
                $merge['birth_year'] = null;
            } elseif (is_numeric($age)) {
                $merge['birth_year'] = (int) date('Y') - (int) round((float) $age);
            }
        }

        if ($merge !== []) {
            $this->merge($merge);
        }
    }

    /** Rules shared by every endpoint that writes part of the profile. */
    protected function profileFieldRules(bool $creating = false): array
    {
        return [
            'weight_kg' => $creating ? ['required', 'numeric', 'min:25', 'max:250'] : ['sometimes', 'numeric', 'min:25', 'max:250'],
            'height_cm' => ['sometimes', 'nullable', 'numeric', 'min:100', 'max:250'],
            'birth_year' => ['sometimes', 'nullable', 'integer', 'min:1930', 'max:'.(int) date('Y')],
            'age' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:110'],
            'sex' => ['sometimes', 'in:female,male,other'],
            'fitness_level' => ['sometimes', 'integer', 'min:1', 'max:5'],
            'experience_level' => ['sometimes', 'integer', 'min:1', 'max:5'],
            'activity_experience' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:70'],
            'sweat_profile' => ['sometimes', 'in:low,normal,high'],
            'typical_temperature_c' => ['sometimes', 'numeric', 'min:-10', 'max:50'],
            'city' => ['sometimes', 'nullable', 'string', 'max:120'],
            'units' => ['sometimes', 'in:metric,imperial'],
        ];
    }
}
