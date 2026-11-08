<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Goal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GoalController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->payload($request->user()->goal ?? $request->user()->ensureGoals())]);
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'daily_calories' => ['sometimes', 'integer', 'min:500', 'max:10000'],
            'daily_distance_km' => ['sometimes', 'numeric', 'min:0.5', 'max:300'],
            'daily_active_min' => ['sometimes', 'integer', 'min:5', 'max:600'],
            'weekly_calories' => ['sometimes', 'integer', 'min:1000', 'max:60000'],
            'weekly_distance_km' => ['sometimes', 'numeric', 'min:1', 'max:2000'],
            'carb_target_g' => ['sometimes', 'integer', 'min:50', 'max:1200'],
        ]);

        $goal = $request->user()->goal ?? $request->user()->ensureGoals();
        $goal->update($validated);

        return response()->json(['data' => $this->payload($goal->fresh())]);
    }

    private function payload(Goal $goal): array
    {
        return [
            'daily_calories' => $goal->daily_calories,
            'daily_distance_km' => (float) $goal->daily_distance_km,
            'daily_active_min' => $goal->daily_active_min,
            'weekly_calories' => $goal->weekly_calories,
            'weekly_distance_km' => (float) $goal->weekly_distance_km,
            'carb_target_g' => $goal->carb_target_g,
        ];
    }
}
