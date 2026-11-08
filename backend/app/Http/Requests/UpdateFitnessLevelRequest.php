<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH /api/profile/fitness-level
 *
 * Accepts `fitness_level` (Step 4 name) or `experience_level` (stored legacy
 * name). Sending {"source":"auto"} hands the level back to the activity-count
 * heuristic and recomputes it immediately.
 */
class UpdateFitnessLevelRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('fitness_level') && ! $this->has('experience_level')) {
            $this->merge(['experience_level' => $this->input('fitness_level')]);
        }
    }

    public function rules(): array
    {
        return [
            'fitness_level' => ['nullable', 'integer', 'min:1', 'max:5'],
            'experience_level' => ['nullable', 'integer', 'min:1', 'max:5'],
            'source' => ['sometimes', Rule::in(['auto', 'user'])],
        ];
    }

    /** A request must either set a level or explicitly ask for the heuristic. */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $hasLevel = $this->filled('fitness_level') || $this->filled('experience_level');
                $wantsAuto = $this->input('source') === 'auto';

                if (! $hasLevel && ! $wantsAuto) {
                    $validator->errors()->add(
                        'fitness_level',
                        'Send fitness_level (1–5), or source=auto to follow your activity count.'
                    );
                }

                if ($hasLevel && $wantsAuto) {
                    $validator->errors()->add(
                        'fitness_level',
                        'Send either fitness_level or source=auto, not both.'
                    );
                }
            },
        ];
    }
}
