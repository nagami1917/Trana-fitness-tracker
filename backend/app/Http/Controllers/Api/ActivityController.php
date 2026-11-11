<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreActivityRequest;
use App\Http\Resources\ActivityResource;
use App\Models\Activity;
use App\Services\ActivityService;
use App\Services\AnalyticsService;
use App\Services\GoalEventRecorder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ActivityController extends Controller
{
    public function __construct(
        private readonly AnalyticsService $analytics,
        private readonly ActivityService $activities,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'type' => ['nullable', 'in:run,ride,walk,hike'],
            'q' => ['nullable', 'string', 'max:120'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $activities = $request->user()->activities()
            ->when($validated['type'] ?? null, fn ($query, $type) => $query->where('activity_type', $type))
            ->when($validated['from'] ?? null, fn ($query, $from) => $query->where('started_at', '>=', $from))
            ->when($validated['to'] ?? null, fn ($query, $to) => $query->where('started_at', '<=', $to))
            ->when($validated['q'] ?? null, function ($query, $term) {
                $query->where(function ($inner) use ($term) {
                    $pattern = '%'.mb_strtolower($term).'%';
                    $inner->whereRaw('LOWER(activity_type) LIKE ?', [$pattern])
                        ->orWhereRaw('LOWER(notes) LIKE ?', [$pattern]);
                });
            })
            ->orderByDesc('started_at')
            ->orderByDesc('id')
            ->paginate($validated['limit'] ?? 200, ['*'], 'page', $validated['page'] ?? 1);

        return response()->json([
            'data' => ActivityResource::collection($activities->getCollection())->toArray($request),
            'meta' => [
                'current_page' => $activities->currentPage(),
                'last_page' => $activities->lastPage(),
                'per_page' => $activities->perPage(),
                'total' => $activities->total(),
            ],
        ]);
    }

    public function store(StoreActivityRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $activity = $this->activities->store($request->user(), $validated);

        // Best-effort: recording a goal achievement must never fail the save.
        try {
            app(GoalEventRecorder::class)->recordForActivity($request->user(), $activity);
        } catch (\Throwable $exception) {
            Log::warning('Goal event recording failed: '.$exception->getMessage());
        }

        return response()->json(['data' => (new ActivityResource($activity->fresh()))->toArray($request)], 201);
    }

    public function show(Request $request, Activity $activity): JsonResponse
    {
        abort_unless($activity->user_id === $request->user()->id, 404);

        return response()->json(['data' => (new ActivityResource($activity))->toArray($request)]);
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


}
