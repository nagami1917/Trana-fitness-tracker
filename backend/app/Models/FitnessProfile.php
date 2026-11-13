<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The athlete's fitness profile (Step 4 of the product spec).
 *
 * Columns are stored in `fitness_profiles`; the spec-facing, read-only
 * `user_profiles` view projects them as
 * id · user_id · age · sex · height_cm · weight_kg · fitness_level ·
 * activity_experience · created_at · updated_at.
 */
class FitnessProfile extends Model
{
    use HasFactory;

    /** Consistent training experience is recorded in years. */
    public const MAX_ACTIVITY_EXPERIENCE_YEARS = 70;

    /** Who owns the 1–5 fitness level. */
    public const LEVEL_SOURCE_AUTO = 'auto';

    public const LEVEL_SOURCE_USER = 'user';

    protected $fillable = [
        'user_id',
        'weight_kg',
        'height_cm',
        'birth_year',
        'sex',
        'sweat_profile',
        'experience_level',
        'fitness_level_source',
        'activity_experience',
        'typical_temperature_c',
        'city',
        'units',
        'resting_hr',
        'max_hr',
        'hr_zones',
        'onboarded_at',
    ];

    protected function casts(): array
    {
        return [
            'weight_kg' => 'float',
            'height_cm' => 'float',
            'birth_year' => 'integer',
            'experience_level' => 'integer',
            'activity_experience' => 'float',
            'typical_temperature_c' => 'float',
            'resting_hr' => 'integer',
            'max_hr' => 'integer',
            'hr_zones' => 'array',
            'onboarded_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Age in whole years, or null when no birth year was given. */
    public function age(): ?int
    {
        if ($this->birth_year === null) {
            return null;
        }

        return max(0, (int) date('Y') - (int) $this->birth_year);
    }

    /** Step 4's `fitness_level`: the 1–5 experience scale used by the model. */
    public function fitnessLevel(): int
    {
        return max(1, min(5, (int) ($this->experience_level ?? 1)));
    }

    /** Step 4's `activity_experience`: years of consistent training, if known. */
    public function activityExperienceYears(): ?float
    {
        return $this->activity_experience === null ? null : (float) $this->activity_experience;
    }

    /**
     * The profile fields handed to the prediction service.
     *
     * Keep this the single place that decides which athlete attributes leave
     * the API — the saved prediction stores the same block as its audit trail.
     *
     * @return array{age: int|null, sex: string, height_cm: float|null, weight_kg: float, fitness_level: int, activity_experience: float|null, sweat_profile: string, typical_temperature_c: float}
     */
    public function predictionContext(): array
    {
        return [
            'age' => $this->age(),
            'sex' => $this->sex ?: 'other',
            'height_cm' => $this->height_cm === null ? null : (float) $this->height_cm,
            'weight_kg' => (float) $this->weight_kg,
            'fitness_level' => $this->fitnessLevel(),
            'activity_experience' => $this->activityExperienceYears(),
            'sweat_profile' => $this->sweat_profile ?: 'normal',
            'typical_temperature_c' => (float) ($this->typical_temperature_c ?? 26),
        ];
    }
}
