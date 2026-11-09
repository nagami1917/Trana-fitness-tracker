<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreActivityPointRequest;
use App\Http\Resources\ActivityPointResource;
use App\Models\Activity;
use App\Models\ActivityPoint;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ActivityPointController extends Controller
{
    /**
     * Record one GPS sample for an activity that is being tracked live.
     *
     * Only the athlete who owns the activity may append points. Server-side
     * validation rejects coordinates/speeds that a device could not produce,
     * so client-reported values are never trusted blindly for aggregates.
     */
    public function store(StoreActivityPointRequest $request, Activity $activity): JsonResponse
    {
        abort_unless($activity->user_id === $request->user()->id, 404);

        $validated = $request->validated();

        $point = $activity->activityPoints()->create([
            'latitude' => $validated['latitude'],
            'longitude' => $validated['longitude'],
            'altitude' => $validated['altitude'] ?? null,
            'speed' => $validated['speed'] ?? null,
            'accuracy' => $validated['accuracy'] ?? null,
            'timestamp' => $validated['timestamp'],
        ]);

        return response()->json([
            'data' => (new ActivityPointResource($point))->toArray($request),
        ], 201);
    }

    /**
     * Fetch the GPS samples of one activity (owned by the athlete only).
     */
    public function index(Request $request, Activity $activity): JsonResponse
    {
        abort_unless($activity->user_id === $request->user()->id, 404);

        $points = $activity->activityPoints()
            ->ordered()
            ->get(['id', 'latitude', 'longitude', 'altitude', 'speed', 'accuracy', 'timestamp']);

        return response()->json([
            'data' => ActivityPointResource::collection($points)->toArray($request),
        ]);
    }
}
