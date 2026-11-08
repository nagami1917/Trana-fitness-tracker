<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreActivityRequest;
use App\Models\Activity;
use App\Services\AnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ActivityController extends Controller
{
    public function __construct(private readonly AnalyticsService $analytics)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'type' => ['nullable', 'in:run,ride,walk,hike'],
            'q' => ['nullable', 'string', 'max:120'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $activities = $request->user()->activities()
            ->when($validated['type'] ?? null, fn ($query, $type) => $query->where('activity_type', $type))
            ->when($validated['from'] ?? null, fn ($query, $from) => $query->where('started_at', '>=', $from))
            ->when($validated['to'] ?? null, fn ($query, $to) => $query->where('started_at', '<=', $to))
            ->when($validated['q'] ?? null, function ($query, $term) {
                $query->where(function ($inner) use ($term) {
                    $inner->where('activity_type', 'ilike', "%{$term}%")
                        ->orWhere('notes', 'ilike', "%{$term}%");
                });
            })
            ->orderByDesc('started_at')
            ->limit($validated['limit'] ?? 200)
            ->get();

        return response()->json(['data' => $activities->map(fn (Activity $a) => $this->payload($a))->values()]);
    }

    public function store(StoreActivityRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $user = $request->user();

        $calories = $validated['calories']
            ?? $this->estimateCalories(
                $validated['activity_type'],
                (float) $validated['distance_km'],
                (float) $validated['duration_min'],
                (int) ($validated['elevation_gain_m'] ?? 0),
                (float) ($user->fitnessProfile?->weight_kg ?? 60),
            );

        $activity = $user->activities()->create([
            'activity_type' => $validated['activity_type'],
            'distance_km' => $validated['distance_km'],
            'duration_min' => $validated['duration_min'],
            'elevation_gain_m' => $validated['elevation_gain_m'] ?? 0,
            'calories' => $calories,
            'avg_heart_rate' => $validated['avg_heart_rate'] ?? null,
            'started_at' => $validated['started_at'],
            'route' => $validated['route'] ?? null,
            'notes' => $validated['notes'] ?? null,
            'source' => $validated['source'] ?? 'manual',
        ]);

        // Keep the athlete's experience bucket in sync with their real history.
        $count = $user->activities()->count();
        $level = match (true) {
            $count >= 40 => 5,
            $count >= 24 => 4,
            $count >= 12 => 3,
            $count >= 5 => 2,
            default => 1,
        };
        $user->fitnessProfile?->update(['experience_level' => $level]);

        return response()->json(['data' => $this->payload($activity->fresh())], 201);
    }

    public function show(Request $request, Activity $activity): JsonResponse
    {
        abort_unless($activity->user_id === $request->user()->id, 404);

        return response()->json(['data' => $this->payload($activity)]);
    }

    public function destroy(Request $request, Activity $activity): JsonResponse
    {
        abort_unless($activity->user_id === $request->user()->id, 404);
        $activity->delete();

        return response()->json(['deleted' => true]);
    }

    public function summary(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->analytics->summary($request->user())]);
    }

    private function payload(Activity $activity): array
    {
        return [
            'id' => $activity->id,
            'activity_type' => $activity->activity_type,
            'distance_km' => (float) $activity->distance_km,
            'elevation_gain_m' => (int) $activity->elevation_gain_m,
            'duration_min' => (float) $activity->duration_min,
            'calories' => (int) $activity->calories,
            'avg_heart_rate' => $activity->avg_heart_rate,
            'started_at' => $activity->started_at?->toIso8601String(),
            'route' => $activity->route,
            'notes' => $activity->notes,
            'source' => $activity->source,
        ];
    }

    /** MET-based estimate; mirrors the client and the Python fueling module. */
    private function estimateCalories(string $type, float $km, float $minutes, int $elevation, float $weightKg): int
    {
        $hours = max($minutes, 1) / 60;
        $speed = $km / max($hours, 0.01);
        $climb = min(2.6, ($km > 0 ? $elevation / $km : 0) * 0.045);

        $met = match ($type) {
            'run' => $speed * 1.03,
            'ride' => 3.2 + $speed * 0.29,
            'walk' => 2.0 + $speed * 0.45,
            default => 3.6 + $speed * 0.60,
        };

        return (int) round(max(1.6, $met + $climb) * $weightKg * $hours);
    }
}
