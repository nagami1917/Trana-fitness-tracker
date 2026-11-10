<?php

namespace App\Services;

use App\Models\Activity;
use App\Models\EnergyExpenditure;
use App\Models\FitnessProfile;
use App\Models\User;
use App\Services\EnergyExpenditureCalibrationService;

/**
 * Activity log access: ML-shaped history for predictions, plus the
 * create/experience-sync logic used by the activities API.
 */
class ActivityService
{
    public function __construct(
        private readonly EnergyExpenditureCalibrationService $calibration,
    ) {}

    /** The athlete's session history, newest first, shaped for the ML service. */
    public function history(User $user, int $limit = 300): array
    {
        return $user->activities()
            ->orderByDesc('started_at')
            ->limit($limit ?: (int) config('ml.history_limit', 300))
            ->get(['id', 'activity_type', 'distance_km', 'duration_min', 'elevation_gain_m', 'calories', 'started_at'])
            ->map(fn (Activity $activity) => [
                'activity_type' => $activity->activity_type,
                'distance_km' => (float) $activity->distance_km,
                'duration_min' => (float) $activity->duration_min,
                'elevation_gain_m' => (int) $activity->elevation_gain_m,
                'calories' => $activity->calories,
                'started_at' => $activity->started_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * Create an activity, estimating calories from MET when omitted, and keep
     * the athlete's experience bucket in sync with their real history.
     *
     * @param  array<string, mixed>  $validated
     */
    public function store(User $user, array $validated): Activity
    {
        $rawCalories = $validated['calories']
            ?? $this->estimateCalories(
                $validated['activity_type'],
                (float) $validated['distance_km'],
                (float) $validated['duration_min'],
                (int) ($validated['elevation_gain_m'] ?? 0),
                (float) ($user->fitnessProfile?->weight_kg ?? 60),
            );

        // TEMP DIAGNOSTIC: calibration bypassed to isolate CI failure
        $calories = (int) round((float) $rawCalories);

        $activity = $user->activities()->create([
            'activity_type' => $validated['activity_type'],
            'distance_km' => $validated['distance_km'],
            'duration_min' => $validated['duration_min'],
            'elevation_gain_m' => $validated['elevation_gain_m'] ?? 0,
            'calories' => $calories,
            'avg_heart_rate' => $validated['avg_heart_rate'] ?? null,
            'started_at' => $validated['started_at'],
            'route' => $validated['route'] ?? null,
            'route_geojson' => $validated['route_geojson'] ?? null,
            'notes' => $validated['notes'] ?? null,
            'source' => $validated['source'] ?? 'manual',
        ]);

        $this->syncExperienceLevel($user);

        return $activity;
    }

    /** Mirror of the client and the Python fueling module's MET estimate. */
    public function estimateCalories(string $type, float $km, float $minutes, int $elevation, float $weightKg): int
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

    /**
     * Bucket the athlete's fitness level from how many sessions they logged.
     *
     * Since Step 4 the athlete can set the level themselves; that choice is
     * marked `fitness_level_source = user` and is never overwritten here unless
     * the caller explicitly forces a recompute (PATCH fitness-level with
     * source=auto).
     */
    public function syncExperienceLevel(User $user, bool $force = false): void
    {
        $profile = $user->fitnessProfile;
        if (! $profile) {
            return;
        }
        if (! $force && $profile->fitness_level_source === FitnessProfile::LEVEL_SOURCE_USER) {
            return;
        }

        $count = $user->activities()->count();
        $level = match (true) {
            $count >= 40 => 5,
            $count >= 24 => 4,
            $count >= 12 => 3,
            $count >= 5 => 2,
            default => 1,
        };
        $profile->update(['experience_level' => $level]);
    }
}
