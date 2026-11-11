<?php

namespace App\Services;

use App\Models\Activity;
use App\Models\GoalEvent;
use App\Models\User;
use Carbon\Carbon;

/**
 * Records a goal achievement the moment an activity pushes a daily or weekly
 * activity goal across its target.
 *
 * Crossing detection mirrors the frontend's live stats exactly:
 * - daily  = activities whose started_at falls on the activity's calendar day
 *            (isSameDay on the client, [dayStart, dayEnd) here),
 * - weekly = activities since the Monday-based start of week up to now.
 * An event fires only when the value was below the target before this
 * activity and is at/above it after (prev < target <= total).
 *
 * The event stores the causing activity_id: deleting the activity removes
 * its achievements via foreign-key cascade.
 */
class GoalEventRecorder
{
    /** goal_key => [activity column, goal column] — all three daily goals. */
    private const DAILY = [
        'daily_calories' => ['calories', 'daily_calories'],
        'daily_distance_km' => ['distance_km', 'daily_distance_km'],
        'daily_active_min' => ['duration_min', 'daily_active_min'],
    ];

    /** Weekly counterparts (energy + distance; active-minutes has no weekly goal). */
    private const WEEKLY = [
        'weekly_calories' => ['calories', 'weekly_calories'],
        'weekly_distance_km' => ['distance_km', 'weekly_distance_km'],
    ];

    private const EPSILON = 0.0001;

    public function recordForActivity(User $user, Activity $activity): void
    {
        $goal = $user->goal;
        $started = $activity->started_at;

        if (! $goal || ! $started) {
            return;
        }

        // Daily window: the activity's own calendar day (client isSameDay).
        $dayStart = $started->copy()->startOfDay();
        $dayEnd = $dayStart->copy()->addDay();
        $dayTotals = $this->totals($user, $dayStart, $dayEnd, null);

        foreach (self::DAILY as $key => [$column, $goalColumn]) {
            $this->crossing($user, $activity, $key, $column, $dayTotals, (float) $goal->{$goalColumn});
        }

        // Weekly window: Monday-based week start → now (client within()).
        if ($started->isFuture()) {
            return; // a future-dated activity is not counted by the client either
        }
        $weekStart = $started->copy()->startOfWeek();
        $weekTotals = $this->totals($user, $weekStart, null, Carbon::now());

        foreach (self::WEEKLY as $key => [$column, $goalColumn]) {
            $this->crossing($user, $activity, $key, $column, $weekTotals, (float) $goal->{$goalColumn});
        }
    }

    /**
     * Sums of calories / distance / duration for the window.
     * $until (nullable) caps the upper bound — the weekly view stops at "now".
     *
     * @return array{calories: float, distance_km: float, duration_min: float}
     */
    private function totals(User $user, Carbon $from, ?Carbon $untilExclusive, ?Carbon $untilInclusive): array
    {
        $query = Activity::where('user_id', $user->id)
            ->where('started_at', '>=', $from);

        if ($untilInclusive !== null) {
            $query->where('started_at', '<=', $untilInclusive);
        } elseif ($untilExclusive !== null) {
            $query->where('started_at', '<', $untilExclusive);
        }

        $row = $query
            ->selectRaw('COALESCE(SUM(calories), 0) AS c, COALESCE(SUM(distance_km), 0) AS d, COALESCE(SUM(duration_min), 0) AS m')
            ->first();

        return [
            'calories' => (float) ($row->c ?? 0),
            'distance_km' => (float) ($row->d ?? 0),
            'duration_min' => (float) ($row->m ?? 0),
        ];
    }

    /**
     * Insert an event when this activity is the one that crossed the target.
     *
     * @param  array{calories: float, distance_km: float, duration_min: float}  $totals
     */
    private function crossing(User $user, Activity $activity, string $key, string $column, array $totals, float $target): void
    {
        if ($target <= 0) {
            return;
        }

        $total = $totals[$column];
        $own = (float) ($activity->{$column} ?? 0);
        $previous = $total - $own;

        if ($previous >= $target - self::EPSILON || $total < $target - self::EPSILON) {
            return; // either already reached before, or still below after
        }

        $already = GoalEvent::where('user_id', $user->id)
            ->where('activity_id', $activity->id)
            ->where('goal_key', $key)
            ->exists();

        if ($already) {
            return;
        }

        GoalEvent::create([
            'user_id' => $user->id,
            'activity_id' => $activity->id,
            'date' => $activity->started_at->toDateString(),
            'goal_key' => $key,
            'target' => round($target, 2),
            'achieved_value' => round($total, 2),
        ]);
    }
}
