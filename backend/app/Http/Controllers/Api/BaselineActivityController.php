<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Services\ActivityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The one-time past-session entry shown during onboarding.
 *
 * The duration model anchors an athlete's pace on their own history: with zero
 * rows it falls back to a generic curve (confidence 0.58), with two it can fit
 * a reference curve (0.88). Onboarding asks for exactly those two sessions so
 * the very first plan is already personalised instead of regressing the user
 * to population averages.
 *
 * Deliberately separate from ActivityController::store:
 *  - it accepts the minimal shape a beginner can actually recall
 *    (type, distance, duration, elevation, date) and refuses anything else;
 *  - the number of rows is capped, so this cannot become a bulk-import route
 *    that bypasses the real activity log;
 *  - rows are flagged `is_baseline`, which keeps them out of dashboard totals
 *    while the model still sees them as history.
 */
class BaselineActivityController extends Controller
{
    /** Two sessions is what the model needs to fit a reference curve. */
    public const MAX_BASELINE_ROWS = 2;

    public function __construct(private readonly ActivityService $activities)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $rows = $request->user()->activities()
            ->where('is_baseline', true)
            ->orderBy('started_at')
            ->get(['id', 'activity_type', 'distance_km', 'duration_min', 'elevation_gain_m', 'started_at']);

        return response()->json([
            'data' => $rows->map(fn (Activity $activity) => $this->payload($activity))->all(),
            'meta' => [
                'max' => self::MAX_BASELINE_ROWS,
                'remaining' => max(0, self::MAX_BASELINE_ROWS - $rows->count()),
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'activity_type' => ['required', Rule::in(Activity::TYPES)],
            'distance_km' => ['required', 'numeric', 'min:0.1', 'max:500'],
            'duration_min' => ['required', 'numeric', 'min:1', 'max:1440'],
            'elevation_gain_m' => ['nullable', 'integer', 'min:0', 'max:12000'],
            'performed_on' => ['required', 'date', 'before_or_equal:today', 'after:-10 years'],
        ], [
            'performed_on.before_or_equal' => 'Choose a date in the past — a baseline is a session you already did.',
        ]);

        $user = $request->user();

        $stored = DB::transaction(function () use ($user, $data) {
            // Lock the user row so two parallel saves cannot both take the
            // last slot and produce three baselines.
            $user = $user->newQuery()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            $existing = $user->activities()->where('is_baseline', true)->count();
            if ($existing >= self::MAX_BASELINE_ROWS) {
                return null;
            }

            return $this->activities->store($user, [
                'activity_type' => $data['activity_type'],
                'distance_km' => (float) $data['distance_km'],
                'duration_min' => (float) $data['duration_min'],
                'elevation_gain_m' => (int) ($data['elevation_gain_m'] ?? 0),
                // Midday on the chosen date: the model only needs ordering and
                // recency, and a fixed time avoids timezone ambiguity at edges.
                'started_at' => $data['performed_on'].' 12:00:00',
                'source' => Activity::SOURCE_BASELINE,
                'is_baseline' => true,
            ]);
        });

        if ($stored === null) {
            return response()->json([
                'message' => 'You already entered both baseline sessions.',
                'code' => 'BASELINE_COMPLETE',
            ], 409);
        }

        $count = $request->user()->activities()->where('is_baseline', true)->count();

        return response()->json([
            'data' => $this->payload($stored->fresh()),
            'meta' => [
                'max' => self::MAX_BASELINE_ROWS,
                'remaining' => max(0, self::MAX_BASELINE_ROWS - $count),
                'complete' => $count >= self::MAX_BASELINE_ROWS,
            ],
        ], 201);
    }

    /** Replace one baseline row, for athletes who mistyped a number. */
    public function update(Request $request, Activity $activity): JsonResponse
    {
        $this->assertOwnedBaseline($request, $activity);

        $data = $request->validate([
            'activity_type' => ['sometimes', Rule::in(Activity::TYPES)],
            'distance_km' => ['sometimes', 'numeric', 'min:0.1', 'max:500'],
            'duration_min' => ['sometimes', 'numeric', 'min:1', 'max:1440'],
            'elevation_gain_m' => ['sometimes', 'integer', 'min:0', 'max:12000'],
            'performed_on' => ['sometimes', 'date', 'before_or_equal:today', 'after:-10 years'],
        ]);

        $activity->fill(array_filter([
            'activity_type' => $data['activity_type'] ?? null,
            'distance_km' => $data['distance_km'] ?? null,
            'duration_min' => $data['duration_min'] ?? null,
            'elevation_gain_m' => $data['elevation_gain_m'] ?? null,
        ], fn ($value) => $value !== null));

        if (isset($data['performed_on'])) {
            $activity->started_at = $data['performed_on'].' 12:00:00';
        }

        $activity->save();

        return response()->json(['data' => $this->payload($activity->fresh())]);
    }

    public function destroy(Request $request, Activity $activity): JsonResponse
    {
        $this->assertOwnedBaseline($request, $activity);
        $activity->delete();

        $count = $request->user()->activities()->where('is_baseline', true)->count();

        return response()->json([
            'meta' => [
                'max' => self::MAX_BASELINE_ROWS,
                'remaining' => max(0, self::MAX_BASELINE_ROWS - $count),
                'complete' => $count >= self::MAX_BASELINE_ROWS,
            ],
        ]);
    }

    private function assertOwnedBaseline(Request $request, Activity $activity): void
    {
        abort_unless($activity->user_id === $request->user()->id, 404);
        abort_unless($activity->is_baseline, 404);
    }

    /** @return array<string, mixed> */
    private function payload(Activity $activity): array
    {
        $minutes = max(0.01, (float) $activity->duration_min);
        $distance = max(0.01, (float) $activity->distance_km);

        return [
            'id' => $activity->id,
            'activity_type' => $activity->activity_type,
            'distance_km' => (float) $activity->distance_km,
            'duration_min' => (float) $activity->duration_min,
            'elevation_gain_m' => (int) $activity->elevation_gain_m,
            'performed_on' => $activity->started_at?->toDateString(),
            // Derived, never stored: pace is duration ÷ distance, so asking the
            // athlete for all three would let them contradict themselves.
            'pace_min_per_km' => round($minutes / $distance, 2),
            'speed_kmh' => round($distance / ($minutes / 60), 2),
        ];
    }
}
