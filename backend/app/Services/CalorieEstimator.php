<?php

namespace App\Services;

/**
 * The MET calorie estimate, in one place.
 *
 * Shared by the activity log (ActivityService) and the energy calibration
 * service, and mirrored by the client and the Python fueling module. Keeping a
 * single implementation means the calibration ratio always compares device
 * calories against the same estimate the app would have made.
 */
class CalorieEstimator
{
    public function estimate(string $type, float $km, float $minutes, int $elevation, float $weightKg): int
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
}
