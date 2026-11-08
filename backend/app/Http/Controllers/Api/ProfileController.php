<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Resources\ProfileResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => (new ProfileResource($request->user()->fresh() ?? $request->user()))->toArray($request)]);
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
        if (array_key_exists('onboarded', $validated)) {
            $profileFields['onboarded_at'] = $validated['onboarded'] ? now() : null;
        }
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

        return response()->json(['data' => (new ProfileResource($user->fresh()))->toArray($request)]);
    }

}
