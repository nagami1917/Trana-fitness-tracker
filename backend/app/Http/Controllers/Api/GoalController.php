<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\GoalResource;
use App\Models\GoalEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GoalController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $goal = $request->user()->goal ?? $request->user()->ensureGoals();

        return response()->json(['data' => (new GoalResource($goal))->toArray($request)]);
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

        return response()->json(['data' => (new GoalResource($goal->fresh()))->toArray($request)]);
    }

    /**
     * Achievement history: newest date first, capped at 100 rows.
     * The frontend groups rows by `date` and shows a per-date count.
     */
    public function history(Request $request): JsonResponse
    {
        $events = GoalEvent::where('user_id', $request->user()->id)
            ->orderByDesc('date')
            ->orderByDesc('id')
            ->limit(100)
            ->get()
            ->map(fn (GoalEvent $event) => [
                'date' => $event->date?->toDateString(),
                'goal_key' => $event->goal_key,
                'target' => (float) $event->target,
                'achieved_value' => (float) $event->achieved_value,
                'created_at' => $event->created_at?->toIso8601String(),
            ]);

        return response()->json(['data' => $events]);
    }

}
