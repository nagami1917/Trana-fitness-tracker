<?php

namespace App\Services;

use Illuminate\Support\Arr;

/**
 * Fueling side of the prediction: converts the ML service's snake_case
 * fueling block into the camelCase shape the Svelte client renders
 * (carbs/sodium/fluid per hour, calories, timeline, notes).
 *
 * Note: the actual fueling math happens in the Python fueling engine
 * (ml/fueling_model/predict.py) — this class only normalises and maps it.
 */
class FuelingPredictionService
{
    /**
     * @return array{intensity: string, met: float, calories: array, carbs: array, sodium: array, fluid: array, timeline: array, notes: array}
     */
    public function normalise(array $result): array
    {
        $fueling = (array) ($result['fueling'] ?? []);

        return [
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
            'kit' => $this->normaliseKit((array) ($fueling['kit'] ?? [])),
            'notes' => array_values((array) ($fueling['notes'] ?? [])),
        ];
    }

    private function normaliseKit(array $kit): array
    {
        if ($kit === []) {
            return ['items' => [], 'totals' => ['carbsG' => 0, 'sodiumMg' => 0, 'fluidMl' => 0], 'cadence' => []];
        }

        return [
            'items' => array_map(fn ($item) => [
                'name' => $item['name'] ?? 'Item',
                'category' => $item['category'] ?? 'gel',
                'quantity' => (int) ($item['quantity'] ?? 1),
                'servingLabel' => $item['serving_label'] ?? 'serving',
                'carbsG' => (int) ($item['carbs_g'] ?? 0),
                'sodiumMg' => (int) ($item['sodium_mg'] ?? 0),
                'fluidMl' => (int) ($item['fluid_ml'] ?? 0),
            ], (array) ($kit['items'] ?? [])),
            'totals' => [
                'carbsG' => (int) Arr::get($kit, 'totals.carbs_g', 0),
                'sodiumMg' => (int) Arr::get($kit, 'totals.sodium_mg', 0),
                'fluidMl' => (int) Arr::get($kit, 'totals.fluid_ml', 0),
            ],
            'cadence' => [
                'feedEveryMin' => Arr::get($kit, 'cadence.feed_every_min'),
                'sipEveryMin' => Arr::get($kit, 'cadence.sip_every_min'),
                'sipMl' => Arr::get($kit, 'cadence.sip_ml'),
            ],
        ];
    }
}
