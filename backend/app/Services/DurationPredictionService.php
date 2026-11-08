<?php

namespace App\Services;

use Illuminate\Support\Arr;

/**
 * Duration side of the prediction: wraps the ML service call and converts its
 * snake_case response into the clock/pace/interval block the client renders.
 *
 * The ML service does not echo the request back, so the effective request
 * distance/elevation are the fallback when its response omits them.
 */
class DurationPredictionService
{
    public function __construct(private readonly MlClient $ml)
    {
    }

    /** Call the FastAPI /predict endpoint. Throws RuntimeException on failure — callers map it to 503. */
    public function predict(array $payload): array
    {
        return $this->ml->predict($payload);
    }

    /**
     * @return array{distance_km: float, elevation_gain_m: int, duration: array, model: array}
     */
    public function normalise(array $result, string $activityType, float $effectiveDistanceKm, int $effectiveElevationM): array
    {
        $duration = (array) Arr::get($result, 'duration', []);

        $minutes = (float) ($duration['minutes'] ?? 0);
        $low = (float) ($duration['range']['low'] ?? $minutes);
        $high = (float) ($duration['range']['high'] ?? $minutes);
        $distance = (float) ($result['distance_km'] ?? 0);
        if ($distance <= 0) {
            $distance = $effectiveDistanceKm;
        }
        $basis = $duration['basis'] ?? null;

        return [
            'distance_km' => round($distance, 2),
            'elevation_gain_m' => (int) ($result['elevation_gain_m'] ?? $effectiveElevationM),
            'duration' => [
                'minutes' => round($minutes, 1),
                'hours' => round($minutes / 60, 2),
                'low' => round($low, 1),
                'high' => round($high, 1),
                'paceMinPerKm' => in_array($activityType, ['run', 'walk', 'hike'], true) && $distance > 0
                    ? round($minutes / $distance, 2)
                    : null,
                'speedKmh' => (float) ($duration['speed_kmh'] ?? 0),
                'confidence' => (float) ($duration['confidence'] ?? 0.8),
                'referenceSpeedKmh' => (float) ($duration['reference_speed_kmh'] ?? 0),
                'basis' => $basis,
            ],
            'model' => [
                'name' => Arr::get($result, 'model.name', 'TRANA duration model'),
                'version' => Arr::get($result, 'model.version', 'unknown'),
                'basis' => $basis,
                'metrics' => Arr::get($result, 'model.metrics', []),
            ],
        ];
    }
}
