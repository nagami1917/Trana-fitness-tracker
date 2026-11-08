<?php

namespace App\Services;

use App\Models\Activity;
use App\Models\Prediction;
use App\Models\User;
use Illuminate\Support\Arr;

/**
 * Orchestrates a TRANA prediction:
 *
 *   history (Supabase) → FastAPI → normalised recommendation → saved prediction
 *
 * The normalisation step converts the Python service's snake_case payload into
 * the exact JSON shape the Svelte client expects (see frontend/src/lib/ml).
 */
class PredictionService
{
    public function __construct(private readonly MlClient $ml)
    {
    }

    /**
     * @param  array{activity_type:string,distance_km:float,elevation_gain_m?:int,route?:array,planned_for?:string,temperature_c?:float}  $input
     */
    public function create(User $user, array $input): Prediction
    {
        $profile = $user->ensureProfile();
        $history = $this->history($user);

        $payload = [
            'activity_type' => $input['activity_type'],
            'distance_km' => (float) $input['distance_km'],
            'elevation_gain_m' => (float) ($input['elevation_gain_m'] ?? 0),
            'weight_kg' => (float) $profile->weight_kg,
            'experience_level' => (int) $profile->experience_level,
            'sweat_profile' => $profile->sweat_profile ?: 'normal',
            'temperature_c' => (float) ($input['temperature_c'] ?? $profile->typical_temperature_c ?? 26),
            'history' => $history,
        ];

        $goal = $user->goal ?? $user->ensureGoals();
        if (! empty($goal->carb_target_g)) {
            $payload['daily_carb_target_g'] = (int) $goal->carb_target_g;
        }

        if (! empty($input['route']) && count($input['route']) > 1) {
            // The service prefers a drawn route over the typed distance so the
            // prediction always matches what the athlete actually plans to do.
            $payload['route'] = array_map(
                fn ($point) => [(float) $point[0], (float) $point[1]],
                $input['route']
            );
            $payload['distance_km'] = $this->routeLengthKm($input['route']);
        }

        $result = $this->ml->predict($payload);
        $recommendation = $this->normalise($result, count($history), $payload['activity_type']);

        return $user->predictions()->create([
            'activity_type' => $input['activity_type'],
            'distance_km' => $recommendation['distance_km'],
            'elevation_gain_m' => (int) $payload['elevation_gain_m'],
            'route' => $input['route'] ?? null,
            'planned_for' => $input['planned_for'] ?? null,
            'status' => $input['status'] ?? 'planned',
            'duration_min' => $recommendation['duration']['minutes'],
            'duration_low_min' => $recommendation['duration']['low'],
            'duration_high_min' => $recommendation['duration']['high'],
            'confidence' => $recommendation['duration']['confidence'],
            'calories' => $recommendation['fueling']['calories']['total'],
            'carbs_per_hour_g' => $recommendation['fueling']['carbs']['perHourG'],
            'carbs_total_g' => $recommendation['fueling']['carbs']['totalG'],
            'sodium_per_hour_mg' => $recommendation['fueling']['sodium']['perHourMg'],
            'fluid_per_hour_ml' => $recommendation['fueling']['fluid']['perHourMl'],
            'intensity' => $recommendation['fueling']['intensity'],
            'met' => $recommendation['fueling']['met'],
            'payload' => $recommendation,
            'model_version' => Arr::get($result, 'model.version', 'unknown'),
        ]);
    }

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
     * Python payload → client payload.
     * snake_case (service) → camelCase (Svelte components).
     */
    private function normalise(array $result, int $historyUsed, string $activityType): array
    {
        $duration = (array) Arr::get($result, 'duration', []);
        $fueling = (array) Arr::get($result, 'fueling', []);

        $minutes = (float) ($duration['minutes'] ?? 0);
        $low = (float) ($duration['range']['low'] ?? $minutes);
        $high = (float) ($duration['range']['high'] ?? $minutes);
        $distance = (float) ($result['distance_km'] ?? 0);

        return [
            'activity_type' => $activityType,
            'distance_km' => round($distance ?: (float) ($duration['distance_km'] ?? 0), 2),
            'elevation_gain_m' => (int) ($result['elevation_gain_m'] ?? 0),
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
                'basis' => $duration['basis'] ?? null,
            ],
            'fueling' => [
                'intensity' => $fueling['intensity'] ?? 'moderate',
                'met' => (float) ($fueling['met'] ?? 0),
                'calories' => [
                    'total' => (int) Arr::get($fueling, 'calories.total', 0),
                    'perHour' => (int) Arr::get($fueling, 'calories.per_hour', 0),
                    'fromCarbsPct' => (int) Arr::get($fueling, 'calories.from_carbs_pct', 50),
                ],
                'carbs' => [
                    'perHourG' => (int) Arr::get($fueling, 'carbs.per_hour_g', 0),
                    'totalG' => (int) Arr::get($fueling, 'carbs.total_g', 0),
                    'dailyTargetG' => (int) Arr::get($fueling, 'carbs.daily_target_g', 0),
                    'preSessionG' => (int) Arr::get($fueling, 'carbs.pre_session_g', 0),
                ],
                'sodium' => [
                    'perHourMg' => (int) Arr::get($fueling, 'sodium.per_hour_mg', 0),
                    'totalMg' => (int) Arr::get($fueling, 'sodium.total_mg', 0),
                ],
                'fluid' => [
                    'perHourMl' => (int) Arr::get($fueling, 'fluid.per_hour_ml', 0),
                    'totalMl' => (int) Arr::get($fueling, 'fluid.total_ml', 0),
                ],
                'timeline' => array_map(fn ($step) => [
                    'window' => $step['window'] ?? '',
                    'label' => $step['label'] ?? '',
                    'detail' => $step['detail'] ?? '',
                    'carbsG' => (int) ($step['carbs_g'] ?? 0),
                    'icon' => $step['icon'] ?? 'meal',
                ], (array) ($fueling['timeline'] ?? [])),
                'notes' => array_values((array) ($fueling['notes'] ?? [])),
            ],
            'history_used' => $historyUsed,
            'model' => [
                'name' => Arr::get($result, 'model.name', 'TRANA duration model'),
                'version' => Arr::get($result, 'model.version', 'unknown'),
                'basis' => $duration['basis'] ?? null,
                'metrics' => Arr::get($result, 'model.metrics', []),
            ],
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /** Haversine length of a [[lat, lng], …] polyline, in kilometres. */
    public function routeLengthKm(array $points): float
    {
        $radius = 6371.0088;
        $total = 0.0;
        $count = count($points);

        for ($i = 1; $i < $count; $i++) {
            [$lat1, $lon1] = [(float) $points[$i - 1][0], (float) $points[$i - 1][1]];
            [$lat2, $lon2] = [(float) $points[$i][0], (float) $points[$i][1]];

            $phi1 = deg2rad($lat1);
            $phi2 = deg2rad($lat2);
            $dPhi = $phi2 - $phi1;
            $dLambda = deg2rad($lon2 - $lon1);

            $a = sin($dPhi / 2) ** 2 + cos($phi1) * cos($phi2) * sin($dLambda / 2) ** 2;
            $total += 2 * $radius * asin(min(1.0, sqrt($a)));
        }

        return round(max(0.1, $total), 3);
    }
}
