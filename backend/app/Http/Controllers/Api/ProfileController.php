<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateProfileRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->payload($request->user())]);
    }

    public function update(UpdateProfileRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $profile = $user->ensureProfile();
        $goal = $user->ensureGoals();

        $validated = $request->validated();

        if (isset($validated['name'])) {
            $user->update(['name' => $validated['name']]);
        }

        $profileFields = array_intersect_key($validated, array_flip([
            'weight_kg', 'height_cm', 'birth_year', 'sex', 'sweat_profile',
            'experience_level', 'typical_temperature_c', 'city', 'units',
        ]));
        if ($profileFields) {
            $profile->update($profileFields);
        }

        $goalFields = [];
        $map = [
            'daily_calorie_goal' => 'daily_calories',
            'daily_distance_goal_km' => 'daily_distance_km',
            'daily_active_min_goal' => 'daily_active_min',
            'weekly_calorie_goal' => 'weekly_calories',
            'weekly_distance_goal_km' => 'weekly_distance_km',
            'daily_carb_goal_g' => 'carb_target_g',
        ];
        foreach ($map as $input => $column) {
            if (isset($validated[$input])) {
                $goalFields[$column] = $validated[$input];
            }
        }
        if ($goalFields) {
            $goal->update($goalFields);
        }

        return response()->json(['data' => $this->payload($user->fresh())]);
    }

    private function payload(User $user): array
    {
        $profile = $user->fitnessProfile ?? $user->ensureProfile();
        $goal = $user->goal ?? $user->ensureGoals();
        $activities = $user->activities()->count();

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
            'experience_level' => (int) $profile->experience_level,
            'typical_temperature_c' => (float) $profile->typical_temperature_c,
            'units' => $profile->units,
            'daily_calorie_goal' => $goal->daily_calories,
            'daily_distance_goal_km' => (float) $goal->daily_distance_km,
            'daily_active_min_goal' => $goal->daily_active_min,
            'weekly_calorie_goal' => $goal->weekly_calories,
            'weekly_distance_goal_km' => (float) $goal->weekly_distance_km,
            'daily_carb_goal_g' => $goal->carb_target_g,
            'onboarded' => $activities > 0,
            'total_activities' => $activities,
        ];
    }
}
