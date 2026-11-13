<?php

namespace App\Http\Resources;

use App\Models\FitnessProfile;
use App\Models\User;
use App\Services\EnergyExpenditureCalibrationService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** Expects an App\Models\User resource. */
class ProfileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        /** @var User $user */
        $user = $this->resource;
        $profile = $user->fitnessProfile ?? $user->ensureProfile();
        $goal = $user->goal ?? $user->ensureGoals();

        return [
            'id' => $profile->id,
            'name' => $user->name,
            'email' => $user->email,
            'avatar_url' => null,
            'weight_kg' => (float) $profile->weight_kg,
            'height_cm' => $profile->height_cm !== null ? (float) $profile->height_cm : null,
            'birth_year' => $profile->birth_year,
            'age' => $profile->age(),
            'sex' => $profile->sex,
            'city' => $profile->city,
            'sweat_profile' => $profile->sweat_profile,
            // Step 4's spec names. `experience_level` stays for existing clients.
            'fitness_level' => $profile->fitnessLevel(),
            'fitness_level_source' => $profile->fitness_level_source ?? FitnessProfile::LEVEL_SOURCE_AUTO,
            'activity_experience' => $profile->activityExperienceYears(),
            'experience_level' => $profile->fitnessLevel(),
            'typical_temperature_c' => (float) $profile->typical_temperature_c,
            'units' => $profile->units,
            'daily_calorie_goal' => $goal->daily_calories,
            'daily_distance_goal_km' => (float) $goal->daily_distance_km,
            'daily_active_min_goal' => $goal->daily_active_min,
            'weekly_calorie_goal' => $goal->weekly_calories,
            'weekly_distance_goal_km' => (float) $goal->weekly_distance_km,
            'daily_carb_goal_g' => $goal->carb_target_g,
            'energy_calibration_factor' => app(EnergyExpenditureCalibrationService::class)->calculateFactor($user),
            'onboarded' => $profile->onboarded_at !== null,
            'total_activities' => $user->activities_count ?? $user->activities()->count(),
        ];
    }
}
