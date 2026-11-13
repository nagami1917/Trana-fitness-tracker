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
            'training_load' => $this->trainingLoad($activities),
            'aerobic_efficiency' => $this->aerobicEfficiency($activities),
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

    /**
     * Acute (7-day) vs Chronic (28-day daily average) workload ratio (ACWR).
     * Combines duration, distance/elevation stress, or heart-rate TRIMP proxy.
     */
    public function trainingLoad(Collection $activities): array
    {
        $now = Carbon::now();
        $acuteFrom = $now->copy()->subDays(6)->startOfDay();
        $chronicFrom = $now->copy()->subDays(27)->startOfDay();

        $sessionLoad = static function (Activity $a): float {
            $minutes = max(0.0, (float) $a->duration_min);
            if ($a->avg_heart_rate && $a->avg_heart_rate >= 60) {
                $intensity = max(0.5, min(2.4, ((float) $a->avg_heart_rate - 50.0) / 80.0));
                return $minutes * $intensity;
            }
            $speed = $minutes > 0 ? ((float) $a->distance_km / ($minutes / 60.0)) : 8.0;
            $base = match ($a->activity_type) {
                'run' => min(2.2, max(0.7, $speed / 8.5)),
                'ride' => min(2.0, max(0.6, $speed / 20.0)),
                'hike' => 0.95,
                default => 0.65,
            };
            return $minutes * $base;
        };

        $acute = 0.0;
        $chronicTotal = 0.0;
        foreach ($activities as $a) {
            if (! $a->started_at) {
                continue;
            }
            $load = $sessionLoad($a);
            if ($a->started_at->greaterThanOrEqualTo($chronicFrom)) {
                $chronicTotal += $load;
            }
            if ($a->started_at->greaterThanOrEqualTo($acuteFrom)) {
                $acute += $load;
            }
        }

        $chronicWeeklyAvg = $chronicTotal / 4.0;
        $acwr = $chronicWeeklyAvg >= 20.0 ? round($acute / $chronicWeeklyAvg, 2) : null;
        $status = match (true) {
            $acwr === null => 'building_base',
            $acwr < 0.8 => 'tapered',
            $acwr <= 1.3 => 'optimal',
            $acwr <= 1.5 => 'building',
            default => 'overreaching',
        };

        return [
            'acute_7d' => round($acute, 1),
            'chronic_28d_weekly_avg' => round($chronicWeeklyAvg, 1),
            'acwr' => $acwr,
            'status' => $status,
            'recovery_bonus_carbs_pct' => ($acwr !== null && $acwr >= 1.3) ? 20 : 0,
        ];
    }

    /** Speed (m/min) per heartbeat across sessions with heart-rate data. */
    public function aerobicEfficiency(Collection $activities, int $limit = 14): array
    {
        return $activities
            ->filter(fn (Activity $a) => $a->avg_heart_rate && $a->avg_heart_rate >= 60 && $a->distance_km > 0 && $a->duration_min > 0)
            ->take($limit)
            ->map(function (Activity $a) {
                $speedMPerMin = ((float) $a->distance_km * 1000.0) / (float) $a->duration_min;
                $ef = round($speedMPerMin / (float) $a->avg_heart_rate, 3);
                return [
                    'id' => $a->id,
                    'date' => $a->started_at?->toDateString(),
                    'activity_type' => $a->activity_type,
                    'efficiency_index' => $ef,
                    'avg_heart_rate' => (int) $a->avg_heart_rate,
                ];
            })
            ->values()
            ->all();
    }
}
