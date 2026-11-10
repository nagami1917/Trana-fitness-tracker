<?php

namespace App\Services;

use App\Models\EnergyExpenditure;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Wearable energy-expenditure samples and the calibration factor they produce.
 *
 * A watch reports what a session really cost; TRANA estimates calories from
 * MET. Once an athlete has imported enough device samples, the systematic gap
 * between the two becomes a calibration factor that ActivityService applies to
 * new estimates (clamped, so one odd import cannot distort every session).
 */
class EnergyExpenditureService
{
    /** Below this many samples the estimate is left untouched (factor 1.0). */
    public const MIN_SAMPLES = 3;

    /** Guard rails for the factor. */
    public const MIN_FACTOR = 0.5;

    public const MAX_FACTOR = 2.0;

    public function __construct(private readonly CalorieEstimator $estimator)
    {
    }

    /**
     * Import device-reported sessions. Re-importing the same
     * (device_type, recorded_at) pair updates that row instead of duplicating
     * it, so repeated imports stay idempotent.
     *
     * @param  array<int, array<string, mixed>>  $entries  validated entries
     * @return array{imported: int, updated: int, calibration: array<string, mixed>}
     */
    public function importBatch(User $user, array $entries): array
    {
        $imported = 0;
        $updated = 0;
        $seen = [];

        foreach ($entries as $entry) {
            $attributes = [
                'device_type' => $entry['device_type'],
                'activity_type' => $entry['activity_type'],
                'distance_km' => $entry['distance_km'],
                'duration_min' => $entry['duration_min'],
                'avg_heart_rate' => $entry['avg_heart_rate'] ?? null,
                'weight_kg' => $entry['weight_kg'] ?? null,
                'measured_calories' => $entry['measured_calories'],
                'recorded_at' => $entry['recorded_at'],
            ];

            // Key on the instant, not the submitted string, so the same session
            // sent with a different UTC offset still updates one row.
            $key = $attributes['device_type'].'|'.strtotime((string) $entry['recorded_at']);
            $sample = $seen[$key] ?? $user->energyExpenditure()
                ->where('device_type', $attributes['device_type'])
                ->where('recorded_at', $attributes['recorded_at'])
                ->first();

            if ($sample) {
                $sample->update($attributes);
                $updated++;
            } else {
                $sample = $user->energyExpenditure()->create($attributes);
                $imported++;
            }

            $seen[$key] = $sample;
        }

        return [
            'imported' => $imported,
            'updated' => $updated,
            'calibration' => $this->calibration($user),
        ];
    }

    /** The athlete's calibration state — also the API payload. */
    public function calibration(User $user): array
    {
        $samples = $this->samples($user);

        $measured = (int) $samples->sum('measured_calories');
        $estimated = (int) $samples->sum(fn (EnergyExpenditure $sample) => $this->estimateFor($user, $sample));

        $applied = $samples->count() >= self::MIN_SAMPLES && $estimated > 0;
        $raw = $estimated > 0 ? $measured / $estimated : 1.0;
        $factor = $applied
            ? round(min(self::MAX_FACTOR, max(self::MIN_FACTOR, $raw)), 4)
            : 1.0;

        return [
            'factor' => $factor,
            'raw_factor' => round($raw, 4),
            'applied' => $applied,
            'samples' => $samples->count(),
            'min_samples' => self::MIN_SAMPLES,
            'min_factor' => self::MIN_FACTOR,
            'max_factor' => self::MAX_FACTOR,
            'measured_calories' => $measured,
            'estimated_calories' => $estimated,
        ];
    }

    /** The factor new calorie estimates are multiplied by (1.0 when inactive). */
    public function factor(User $user): float
    {
        return (float) $this->calibration($user)['factor'];
    }

    /** Apply the athlete's calibration to a MET calorie estimate. */
    public function calibrate(User $user, int $calories): int
    {
        $factor = $this->factor($user);

        return $factor == 1.0 ? $calories : (int) round($calories * $factor);
    }

    /** The athlete's imported samples, newest session first. */
    public function samples(User $user): Collection
    {
        return $user->energyExpenditure()->orderByDesc('recorded_at')->get();
    }

    /** What TRANA's MET estimate would have said for a device sample. */
    private function estimateFor(User $user, EnergyExpenditure $sample): int
    {
        // The weight recorded with the sample wins; otherwise the profile's.
        $weight = (float) ($sample->weight_kg ?? $user->fitnessProfile?->weight_kg ?? 60);

        return $this->estimator->estimate(
            $sample->activity_type,
            (float) $sample->distance_km,
            (float) $sample->duration_min,
            0,
            $weight,
        );
    }
}
