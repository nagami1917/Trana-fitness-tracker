<?php

namespace App\Services;

use App\Models\Activity;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/** Aggregates an athlete's log for the analytics screen and the ML retrain job. */
class AnalyticsService
{
    public function summary(User $user): array
    {
        $activities = $user->activities()->orderByDesc('started_at')->get();
        $today = $activities->filter(fn (Activity $a) => $a->started_at?->isToday());
        $week = $activities->filter(fn (Activity $a) => $a->started_at?->greaterThanOrEqualTo(Carbon::now()->startOfWeek()));

        return [
            'totals' => $this->totals($activities),
            'today' => $this->totals($today),
            'week' => $this->totals($week),
            'streak_days' => $this->streak($activities),
            'by_type' => $this->byType($activities),
            'weekly_series' => $this->weeklySeries($activities),
            'pace_trend' => $this->paceTrend($activities),
            'personal_bests' => $this->personalBests($activities),
        ];
    }

    public function totals(Collection $activities): array
    {
        return [
            'sessions' => $activities->count(),
            'distance_km' => round((float) $activities->sum('distance_km'), 2),
            'duration_min' => round((float) $activities->sum('duration_min'), 1),
            'calories' => (int) $activities->sum('calories'),
            'elevation_gain_m' => (int) $activities->sum('elevation_gain_m'),
        ];
    }

    public function byType(Collection $activities): array
    {
        return collect(Activity::TYPES)
            ->map(fn (string $type) => [
                'activity_type' => $type,
                ...$this->totals($activities->where('activity_type', $type)),
            ])
            ->all();
    }

    public function weeklySeries(Collection $activities, int $weeks = 13): array
    {
        return collect(range($weeks - 1, 0))
            ->map(function (int $offset) use ($activities) {
                $start = Carbon::now()->startOfWeek()->subWeeks($offset);
                $end = (clone $start)->endOfWeek();
                $bucket = $activities->filter(
                    fn (Activity $a) => $a->started_at && $a->started_at->between($start, $end)
                );

                return ['week_start' => $start->toDateString(), ...$this->totals($bucket)];
            })
            ->values()
            ->all();
    }

    public function paceTrend(Collection $activities, int $limit = 14): array
    {
        return $activities
            ->where('activity_type', 'run')
            ->where('distance_km', '>=', 3)
            ->take($limit)
            ->map(fn (Activity $a) => [
                'id' => $a->id,
                'date' => $a->started_at?->toDateString(),
                'pace_min_per_km' => round((float) $a->duration_min / max(0.1, (float) $a->distance_km), 2),
                'distance_km' => (float) $a->distance_km,
            ])
            ->values()
            ->all();
    }

    public function personalBests(Collection $activities): array
    {
        $longest = $activities->sortByDesc('distance_km')->first();
        $biggest = $activities->sortByDesc('calories')->first();
        $fastest = $activities
            ->where('activity_type', 'run')
            ->where('distance_km', '>=', 4.5)
            ->sortBy(fn (Activity $a) => $a->duration_min / max(0.1, (float) $a->distance_km))
            ->first();

        return [
            'longest' => $longest ? ['id' => $longest->id, 'distance_km' => (float) $longest->distance_km, 'type' => $longest->activity_type] : null,
            'biggest_burn' => $biggest ? ['id' => $biggest->id, 'calories' => $biggest->calories] : null,
            'fastest_run' => $fastest ? [
                'id' => $fastest->id,
                'pace_min_per_km' => round((float) $fastest->duration_min / max(0.1, (float) $fastest->distance_km), 2),
            ] : null,
        ];
    }

    public function streak(Collection $activities): int
    {
        $days = $activities
            ->map(fn (Activity $a) => $a->started_at?->toDateString())
            ->filter()
            ->unique()
            ->flip();

        $cursor = Carbon::today();
        if (! $days->has($cursor->toDateString())) {
            $cursor->subDay();
        }

        $count = 0;
        while ($days->has($cursor->toDateString())) {
            $count++;
            $cursor->subDay();
        }

        return $count;
    }
}
