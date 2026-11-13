<?php

namespace App\Services;

use App\Models\EnergyExpenditure;

/**
 * Calibrates TRANA's calorie estimates against wearable-measured energy
 * expenditure (e.g. WEEE dataset).
 *
 * Returns a multiplier: 1.0 = no adjustment, >1.0 = TRANA underestimates,
 * <1.0 = TRANA overestimates.
 */
class EnergyExpenditureCalibrationService
{
    /** Minimum number of measurements before applying calibration. */
    public const MIN_SAMPLES = 3;

    /**
     * Calculate the calibration multiplier for a user.
     *
     * Compares wearable-measured calories against TRANA's MET-based estimate
     * for the same activities. Returns 1.0 when there isn't enough data.
     */
    public function calculateFactor($user): float
    {
        $rows = EnergyExpenditure::forUser($user->id)
            ->withMeasured()
            ->whereNotNull('trana_estimated_calories')
            ->get();

        $count = $rows->count();
        if ($count < self::MIN_SAMPLES) {
            return 1.0;
        }

        $totalRatio = 0.0;
        $validCount = 0;
        foreach ($rows as $row) {
            $estimated = (float) $row->trana_estimated_calories;
            if ($estimated <= 0) {
                continue;
            }
            $totalRatio += (float) $row->measured_calories / $estimated;
            $validCount++;
        }

        if ($validCount < self::MIN_SAMPLES || $totalRatio === 0.0) {
            return 1.0;
        }

        $factor = $totalRatio / $validCount;

        // Clamp to sane bounds so a single outlier can't skew too far
        return (float) max(0.5, min(2.0, $factor));
    }

    /**
     * Apply the calibration factor to a calorie estimate.
     */
    public function applyCalibration(float $calories, $user): float
    {
        return $calories * $this->calculateFactor($user);
    }
}
