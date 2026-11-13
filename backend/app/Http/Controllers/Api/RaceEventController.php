<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\RaceEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class RaceEventController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $events = $request->user()->raceEvents()
            ->orderBy('race_date')
            ->get()
            ->map(fn (RaceEvent $event) => $this->format($event));

        return response()->json(['data' => $events]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:100'],
            'activity_type' => ['required', Rule::in(Activity::TYPES)],
            'race_date' => ['required', 'date'],
            'distance_km' => ['required', 'numeric', 'min:0.5', 'max:500'],
            'elevation_gain_m' => ['nullable', 'integer', 'min:0', 'max:12000'],
            'goal_time_min' => ['nullable', 'numeric', 'min:1', 'max:2880'],
            'carb_loading_enabled' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $event = $request->user()->raceEvents()->create([
            'title' => $validated['title'],
            'activity_type' => $validated['activity_type'],
            'race_date' => $validated['race_date'],
            'distance_km' => round((float) $validated['distance_km'], 2),
            'elevation_gain_m' => (int) ($validated['elevation_gain_m'] ?? 0),
            'goal_time_min' => isset($validated['goal_time_min']) ? round((float) $validated['goal_time_min'], 1) : null,
            'carb_loading_enabled' => $validated['carb_loading_enabled'] ?? true,
            'notes' => $validated['notes'] ?? null,
        ]);

        return response()->json(['data' => $this->format($event)], 201);
    }

    public function update(Request $request, RaceEvent $raceEvent): JsonResponse
    {
        abort_unless($raceEvent->user_id === $request->user()->id, 404);

        $validated = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:100'],
            'activity_type' => ['sometimes', 'required', Rule::in(Activity::TYPES)],
            'race_date' => ['sometimes', 'required', 'date'],
            'distance_km' => ['sometimes', 'required', 'numeric', 'min:0.5', 'max:500'],
            'elevation_gain_m' => ['sometimes', 'integer', 'min:0', 'max:12000'],
            'goal_time_min' => ['sometimes', 'nullable', 'numeric', 'min:1', 'max:2880'],
            'carb_loading_enabled' => ['sometimes', 'boolean'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        $raceEvent->update($validated);

        return response()->json(['data' => $this->format($raceEvent->fresh())]);
    }

    public function destroy(Request $request, RaceEvent $raceEvent): JsonResponse
    {
        abort_unless($raceEvent->user_id === $request->user()->id, 404);
        $raceEvent->delete();

        return response()->json(['deleted' => true]);
    }

    private function format(RaceEvent $event): array
    {
        return [
            'id' => $event->id,
            'title' => $event->title,
            'activity_type' => $event->activity_type,
            'race_date' => $event->race_date?->toDateString(),
            'distance_km' => (float) $event->distance_km,
            'elevation_gain_m' => (int) $event->elevation_gain_m,
            'goal_time_min' => $event->goal_time_min !== null ? (float) $event->goal_time_min : null,
            'carb_loading_enabled' => (bool) $event->carb_loading_enabled,
            'notes' => $event->notes,
        ];
    }
}
