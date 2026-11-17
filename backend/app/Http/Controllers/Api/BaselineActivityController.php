<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Services\ActivityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The one-time past-session entry shown during onboarding.
 *
 * The duration model fits a reference pace curve from an athlete's own history,
 * separately per activity type: with zero rows of that type it falls back to a
 * generic curve (confidence 0.58), with two it can fit a curve (0.88). The cap
 * is therefore per type, not global — two walks do nothing for a planned ride,
 * and completing one sport must never block another.
 *
 * Deliberately separate from ActivityController::store:
 *  - it accepts the minimal shape a beginner can actually recall;
 *  - rows are capped per type, so this cannot become a bulk-import route;
 *  - rows are flagged `is_baseline`, which keeps them out of dashboard totals
 *    while the model still sees them as history.
 */
class BaselineActivityController extends Controller
{
    /** Two sessions of a type is what the model needs to fit a curve. */
    public const MAX_BASELINE_ROWS_PER_TYPE = 2;

    /**
     * Plausible speed per activity type, in km/h.
     *
     * MUST match ml/duration_model/preprocess.py::SPEED_BOUNDS_KMH. The model
     * silently discards any history row outside these bounds, so accepting one
     * here would save a row, show it as saved, and then have the estimate
     * ignore it — the athlete would be told "based on your 2 sessions" while
     * the curve was fitted from none.
     */
    public const SPEED_BOUNDS_KMH = [
        'run' => [2.5, 30.0],
        'ride' => [1.5, 65.0],
        'walk' => [0.5, 14.0],
        'hike' => [0.5, 14.0],
    ];

    /** Relative periods the UI offers instead of a date picker. */
    public const PERIOD_OFFSET_DAYS = [
        'this_week' => 3,
        'last_week' => 10,
        'this_month' => 20,
        'few_months' => 75,
        'longer_ago' => 200,
    ];

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
            'meta' => $this->meta($rows->groupBy('activity_type')->map->count()->all()),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateRow($request, required: true);
        $type = $data['activity_type'];
        $this->assertPlausible($type, (float) $data['distance_km'], $data);

        $user = $request->user();

        $stored = DB::transaction(function () use ($user, $data, $type) {
            // Lock the user row so two parallel saves cannot both take the
            // last slot for this type and produce three baselines.
            $user = $user->newQuery()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            $existing = $user->activities()
                ->where('is_baseline', true)
                ->where('activity_type', $type)
                ->count();

            if ($existing >= self::MAX_BASELINE_ROWS_PER_TYPE) {
                return null;
            }

            return $this->activities->store($user, [
                'activity_type' => $type,
                'distance_km' => (float) $data['distance_km'],
                'duration_min' => $data['duration_min'],
                'elevation_gain_m' => (int) ($data['elevation_gain_m'] ?? 0),
                // Midday on the resolved date: the model only needs ordering and
                // recency, and a fixed time avoids timezone ambiguity at edges.
                'started_at' => $data['performed_on'].' 12:00:00',
                'source' => Activity::SOURCE_BASELINE,
                'is_baseline' => true,
            ]);
        });

        if ($stored === null) {
            return response()->json([
                'message' => 'You already entered both past '.$this->label($type).' sessions.',
                'code' => 'BASELINE_COMPLETE',
                'activity_type' => $type,
            ], 409);
        }

        return response()->json([
            'data' => $this->payload($stored->fresh()),
            'meta' => $this->meta($this->countsByType($request)),
        ], 201);
    }

    /** Replace one baseline row, for athletes who mistyped a number. */
    public function update(Request $request, Activity $activity): JsonResponse
    {
        $this->assertOwnedBaseline($request, $activity);

        $data = $this->validateRow($request, required: false);

        $type = $data['activity_type'] ?? $activity->activity_type;
        $distance = (float) ($data['distance_km'] ?? $activity->distance_km);
        $this->assertPlausible($type, $distance, $data, $activity);

        // Moving a row to a different type must not overshoot that type's cap.
        if ($type !== $activity->activity_type
            && ($this->countsByType($request)[$type] ?? 0) >= self::MAX_BASELINE_ROWS_PER_TYPE) {
            return response()->json([
                'message' => 'You already entered both past '.$this->label($type).' sessions.',
                'code' => 'BASELINE_COMPLETE',
                'activity_type' => $type,
            ], 409);
        }

        $activity->fill(array_filter([
            'activity_type' => $data['activity_type'] ?? null,
            'distance_km' => $data['distance_km'] ?? null,
            'duration_min' => $data['duration_min'] ?? null,
            'elevation_gain_m' => $data['elevation_gain_m'] ?? null,
        ], fn ($value) => $value !== null));

        if (isset($data['duration_min'])) {
            $activity->duration_min = $data['duration_min'];
        } elseif (isset($data['pace_min_per_km'])) {
            $activity->duration_min = round((float) $data['pace_min_per_km'] * $distance, 2);
        }

        if (isset($data['performed_on'])) {
            $activity->started_at = $data['performed_on'].' 12:00:00';
        }

        $activity->save();

        return response()->json([
            'data' => $this->payload($activity->fresh()),
            'meta' => $this->meta($this->countsByType($request)),
        ]);
    }

    public function destroy(Request $request, Activity $activity): JsonResponse
    {
        $this->assertOwnedBaseline($request, $activity);
        $activity->delete();

        return response()->json(['meta' => $this->meta($this->countsByType($request))]);
    }

    /**
     * Validate one baseline row.
     *
     * Duration may be given directly or as a pace; both normalise to
     * duration_min so the database cannot hold a self-contradicting row.
     *
     * @return array<string, mixed>
     */
    private function validateRow(Request $request, bool $required): array
    {
        // A create must supply a complete row; a partial update only validates
        // the fields it actually sends. Using required_without for both would
        // make "change just the distance" fail, because neither duration nor
        // pace is present.
        $rules = $required
            ? [
                'activity_type' => ['required', Rule::in(Activity::TYPES)],
                'distance_km' => ['required', 'numeric', 'min:0.1', 'max:500'],
                'duration_min' => ['required_without:pace_min_per_km', 'numeric', 'min:1', 'max:1440'],
                'pace_min_per_km' => ['required_without:duration_min', 'numeric', 'min:0.5', 'max:120'],
                // Either a real date or one of the relative period keys the UI
                // offers, so a beginner never has to recall an exact day.
                'performed_on' => ['nullable', 'date', 'before_or_equal:today', 'after:-10 years', 'required_without:performed_period'],
                'performed_period' => ['nullable', Rule::in(array_keys(self::PERIOD_OFFSET_DAYS))],
            ]
            : [
                'activity_type' => ['sometimes', Rule::in(Activity::TYPES)],
                'distance_km' => ['sometimes', 'numeric', 'min:0.1', 'max:500'],
                'duration_min' => ['sometimes', 'numeric', 'min:1', 'max:1440'],
                'pace_min_per_km' => ['sometimes', 'numeric', 'min:0.5', 'max:120'],
                'performed_on' => ['sometimes', 'nullable', 'date', 'before_or_equal:today', 'after:-10 years'],
                'performed_period' => ['sometimes', 'nullable', Rule::in(array_keys(self::PERIOD_OFFSET_DAYS))],
            ];

        $rules['elevation_gain_m'] = ['sometimes', 'nullable', 'integer', 'min:0', 'max:12000'];

        $data = $request->validate($rules, [
            'performed_on.before_or_equal' => 'Choose a date in the past — a baseline is a session you already did.',
        ]);

        if (isset($data['performed_period'])) {
            $data['performed_on'] = now()
                ->subDays(self::PERIOD_OFFSET_DAYS[$data['performed_period']])
                ->toDateString();
        }

        // Pace is the UI's alternative to a time entry; convert so the stored
        // row is identical whichever way the athlete chose to think about it.
        // A partial update may send a pace without a distance (the stored
        // distance applies), so that case is left to update(), which knows it.
        if (isset($data['pace_min_per_km'], $data['distance_km']) && ! isset($data['duration_min'])) {
            $data['duration_min'] = round((float) $data['pace_min_per_km'] * (float) $data['distance_km'], 2);
        }

        return $data;
    }

    /**
     * Reject speeds the model would silently discard.
     *
     * @param  array<string, mixed>  $data
     */
    private function assertPlausible(string $type, float $distanceKm, array $data, ?Activity $activity = null): void
    {
        $minutes = isset($data['duration_min'])
            ? (float) $data['duration_min']
            : (float) ($activity?->duration_min ?? 0);

        // A create that supplied only a pace has already been converted by
        // validateRow; a partial update that supplied only a pace has not,
        // because there is no distance to multiply by yet.
        if (! isset($data['duration_min']) && isset($data['pace_min_per_km'])) {
            $minutes = (float) $data['pace_min_per_km'] * $distanceKm;
        }

        if ($distanceKm <= 0 || $minutes <= 0) {
            return;
        }

        [$min, $max] = self::SPEED_BOUNDS_KMH[$type] ?? [0.5, 60.0];
        $speed = $distanceKm / ($minutes / 60);

        if ($speed < $min || $speed > $max) {
            throw ValidationException::withMessages([
                'distance_km' => sprintf(
                    'A %s at %s km/h isn\'t plausible — check the distance and time. TRANA expects %s–%s km/h.',
                    $this->label($type),
                    rtrim(rtrim(number_format($speed, 1), '0'), '.'),
                    rtrim(rtrim(number_format($min, 1), '0'), '.'),
                    rtrim(rtrim(number_format($max, 1), '0'), '.'),
                ),
            ]);
        }
    }

    /** @return array<string, int> */
    private function countsByType(Request $request): array
    {
        return $request->user()->activities()
            ->where('is_baseline', true)
            ->selectRaw('activity_type, COUNT(*) as aggregate')
            ->groupBy('activity_type')
            ->pluck('aggregate', 'activity_type')
            ->map(fn ($count) => (int) $count)
            ->all();
    }

    /**
     * Per-type progress, so the client can show "2 of 2 runs" while "0 of 2
     * rides" stays available.
     *
     * @param  array<string, int>  $counts
     * @return array<string, mixed>
     */
    private function meta(array $counts): array
    {
        $byType = [];
        foreach (Activity::TYPES as $type) {
            $count = (int) ($counts[$type] ?? 0);
            $byType[$type] = [
                'count' => $count,
                'max' => self::MAX_BASELINE_ROWS_PER_TYPE,
                'remaining' => max(0, self::MAX_BASELINE_ROWS_PER_TYPE - $count),
                'complete' => $count >= self::MAX_BASELINE_ROWS_PER_TYPE,
            ];
        }

        return [
            'max' => self::MAX_BASELINE_ROWS_PER_TYPE,
            'by_type' => $byType,
            // Retained for older clients: total remaining across all sports.
            'remaining' => array_sum(array_column($byType, 'remaining')),
        ];
    }

    private function assertOwnedBaseline(Request $request, Activity $activity): void
    {
        abort_unless($activity->user_id === $request->user()->id, 404);
        abort_unless($activity->is_baseline, 404);
    }

    private function label(string $type): string
    {
        return match ($type) {
            'run' => 'run',
            'ride' => 'ride',
            'walk' => 'walk',
            'hike' => 'hike',
            default => 'session',
        };
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
            // Elevation relative to distance is what the model actually uses.
            'elevation_per_km' => round(((int) $activity->elevation_gain_m) / $distance, 1),
        ];
    }
}
