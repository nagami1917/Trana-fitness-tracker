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
        private readonly EnergyExpenditureCalibrationService $calibration,
        private readonly AnalyticsService $analytics,
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

        // Step 4: the profile is the source of the athlete attributes the model
        // is allowed to see. `predictionContext()` is also stored with the
        // saved prediction, so every plan records which values produced it.
        $profileContext = $profile->predictionContext();

        $calibrationFactor = $this->calibration->calculateFactor($user);

        $payload = [
            'activity_type' => $input['activity_type'],
            'distance_km' => $distanceKm,
            'elevation_gain_m' => (float) ($input['elevation_gain_m'] ?? 0),
            'weight_kg' => $profileContext['weight_kg'],
            'experience_level' => $profileContext['fitness_level'],
            'age' => $profileContext['age'],
            'sex' => $profileContext['sex'],
            'height_cm' => $profileContext['height_cm'],
            'fitness_level' => $profileContext['fitness_level'],
            'activity_experience' => $profileContext['activity_experience'],
            'sweat_profile' => $input['sweat_profile'] ?? $profileContext['sweat_profile'],
            'temperature_c' => (float) ($input['temperature_c'] ?? $profileContext['typical_temperature_c'] ?? 26),
            'energy_calibration_factor' => $calibrationFactor,
            'history' => $history,
        ];

        if ($profile->max_hr) {
            $payload['max_hr'] = (int) $profile->max_hr;
        }
        if ($profile->resting_hr) {
            $payload['resting_hr'] = (int) $profile->resting_hr;
        }

        $fuelItems = $user->fuelItems()
            ->where('is_active', true)
            ->orderBy('id')
            ->limit(25)
            ->get(['name', 'category', 'carbs_g', 'sodium_mg', 'fluid_ml', 'serving_label'])
            ->map(fn ($item) => [
                'name' => $item->name,
                'category' => $item->category,
                'carbs_g' => (float) $item->carbs_g,
                'sodium_mg' => (int) $item->sodium_mg,
                'fluid_ml' => (int) $item->fluid_ml,
                'serving_label' => $item->serving_label,
            ])
            ->all();
        if ($fuelItems !== []) {
            $payload['fuel_items'] = $fuelItems;
        }

        $goal = $user->goal ?? $user->ensureGoals();
        if (! empty($goal->carb_target_g)) {
            $payload['daily_carb_target_g'] = (int) $goal->carb_target_g;
        }

        $recentActs = $user->activities()
            ->where('started_at', '>=', now()->subDays(28))
            ->get();
        if ($recentActs->isNotEmpty()) {
            $load = $this->analytics->trainingLoad($recentActs);
            if ($load['acwr'] !== null) {
                $payload['acwr'] = (float) $load['acwr'];
            }
        }

        $upcomingCarbRace = $user->raceEvents()
            ->where('carb_loading_enabled', true)
            ->whereDate('race_date', '>=', now()->toDateString())
            ->whereDate('race_date', '<=', now()->addDays(2)->toDateString())
            ->exists();
        if ($upcomingCarbRace) {
            $payload['carb_loading'] = true;
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
            'profile' => $profileContext,
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
