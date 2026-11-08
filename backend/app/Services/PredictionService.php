<?php

namespace App\Services;

use App\Models\Prediction;
use App\Models\User;

/**
 * Orchestrates a TRANA prediction:
 *
 *   history (Supabase) → FastAPI → normalised recommendation → saved prediction
 *
 * The heavy lifting lives in dedicated services:
 *   - RouteService            drawn-route measurement + distance resolution
 *   - ActivityService         athlete history + logging
 *   - DurationPredictionService  ML call + clock/pace/interval normalisation
 *   - FuelingPredictionService  fueling block normalisation
 */
class PredictionService
{
    public function __construct(
        private readonly DurationPredictionService $durations,
        private readonly FuelingPredictionService $fueling,
        private readonly RouteService $routes,
        private readonly ActivityService $activities,
    ) {
    }

    /**
     * @param  array{activity_type:string,distance_km?:float,elevation_gain_m?:int,route?:array,planned_for?:string,temperature_c?:float,status?:string}  $input
     */
    public function create(User $user, array $input): Prediction
    {
        $profile = $user->ensureProfile();
        $history = $this->activities->history($user);

        // distance_km is optional when the athlete draws a route; the drawn
        // route wins and is measured with the haversine formula. The ML
        // service validates distance_km > 0, so the effective distance must be
        // known before the HTTP call — not after.
        $routeContext = $this->routes->effectiveContext($input);
        $distanceKm = $routeContext['distance_km'];

        $payload = [
            'activity_type' => $input['activity_type'],
            'distance_km' => $distanceKm,
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

        if ($routeContext['route'] !== null) {
            // The service prefers a drawn route over the typed distance so the
            // prediction always matches what the athlete actually plans to do.
            $payload['route'] = $routeContext['route'];
            $payload['distance_km'] = $distanceKm; // haversine length, measured above
        }

        $result = $this->durations->predict($payload);
        $activityType = (string) $payload['activity_type'];

        $durationPart = $this->durations->normalise(
            $result,
            $activityType,
            (float) $payload['distance_km'],
            (int) $payload['elevation_gain_m'],
        );

        // Python payload → client payload (snake_case → camelCase).
        $recommendation = [
            'activity_type' => $activityType,
            'distance_km' => $durationPart['distance_km'],
            'elevation_gain_m' => $durationPart['elevation_gain_m'],
            'duration' => $durationPart['duration'],
            'fueling' => $this->fueling->normalise($result),
            'history_used' => count($history),
            'model' => $durationPart['model'],
            'generated_at' => now()->toIso8601String(),
        ];

        return $user->predictions()->create([
            'activity_type' => $input['activity_type'],
            'distance_km' => $recommendation['distance_km'],
            'elevation_gain_m' => $recommendation['elevation_gain_m'],
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
            'model_version' => $recommendation['model']['version'],
        ]);
    }
}
