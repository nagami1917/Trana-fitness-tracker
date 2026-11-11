<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDailySessionFoodRequest;
use App\Http\Resources\DailySessionFoodResource;
use App\Http\Resources\DailySessionResource;
use App\Models\DailySession;
use App\Models\DailySessionFood;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DailySessionFoodController extends Controller
{
    /** Add a food item to a daily session. */
    public function store(StoreDailySessionFoodRequest $request, DailySession $dailySession): JsonResponse
    {
        abort_unless($dailySession->user_id === $request->user()->id, 404);

        $validated = $request->validated();

        $food = $dailySession->foods()->create([
            'meal_type' => $validated['meal_type'],
            'food_name' => $validated['food_name'],
            'calories' => $validated['calories'],
            'carbs_g' => $validated['carbs_g'] ?? 0,
            'protein_g' => $validated['protein_g'] ?? 0,
            'fat_g' => $validated['fat_g'] ?? 0,
            'quantity' => $validated['quantity'] ?? 1,
            'notes' => $validated['notes'] ?? null,
        ]);

        $totalEaten = (int) $dailySession->foods()->sum('calories');
        $dailySession->update(['calories_eaten' => $totalEaten]);

        return response()->json([
            'data' => new DailySessionFoodResource($food),
            'session' => new DailySessionResource($dailySession->fresh()->load('foods')),
        ], 201);
    }

    /** Update a food item. */
    public function update(Request $request, DailySession $dailySession, DailySessionFood $dailySessionFood): JsonResponse
    {
        abort_unless(
            $dailySession->user_id === $request->user()->id
            && $dailySessionFood->daily_session_id === $dailySession->id,
            404
        );

        $validated = $request->validate([
            'meal_type' => ['sometimes', 'string', 'in:breakfast,lunch,dinner,snack'],
            'food_name' => ['sometimes', 'string', 'max:120'],
            'calories' => ['sometimes', 'integer', 'min:0', 'max:50000'],
            'carbs_g' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000'],
            'protein_g' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000'],
            'fat_g' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000'],
            'quantity' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        foreach (['carbs_g', 'protein_g', 'fat_g'] as $macro) {
            if (array_key_exists($macro, $validated) && $validated[$macro] === null) {
                $validated[$macro] = 0;
            }
        }
        if (array_key_exists('quantity', $validated) && $validated['quantity'] === null) {
            $validated['quantity'] = 1;
        }

        $dailySessionFood->update($validated);

        $totalEaten = (int) $dailySession->foods()->sum('calories');
        $dailySession->update(['calories_eaten' => $totalEaten]);

        return response()->json([
            'data' => new DailySessionFoodResource($dailySessionFood->fresh()),
            'session' => new DailySessionResource($dailySession->fresh()->load('foods')),
        ]);
    }

    /** Delete a food item. */
    public function destroy(Request $request, DailySession $dailySession, DailySessionFood $dailySessionFood): JsonResponse
    {
        abort_unless(
            $dailySession->user_id === $request->user()->id
            && $dailySessionFood->daily_session_id === $dailySession->id,
            404
        );

        $dailySessionFood->delete();

        $totalEaten = (int) $dailySession->foods()->sum('calories');
        $dailySession->update(['calories_eaten' => $totalEaten]);

        return response()->json([
            'deleted' => true,
            'session' => new DailySessionResource($dailySession->fresh()->load('foods')),
        ]);
    }
}
