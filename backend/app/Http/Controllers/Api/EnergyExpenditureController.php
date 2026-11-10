<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreEnergyExpenditureRequest;
use App\Models\EnergyExpenditure;
use App\Services\EnergyExpenditureCalibrationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EnergyExpenditureController extends Controller
{
    public function __construct(
        private readonly EnergyExpenditureCalibrationService $calibration,
    ) {}

    /**
     * List the authenticated user's energy expenditure entries.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $rows = EnergyExpenditure::forUser($request->user()->id)
            ->withMeasured()
            ->orderByDesc('recorded_at')
            ->orderByDesc('id')
            ->paginate($validated['limit'] ?? 30, ['*'], 'page', $validated['page'] ?? 1);

        // Computed once: the factor is a property of the athlete, not the row,
        // and recalculating it per row would reload every sample each time.
        $factor = $this->calibration->calculateFactor($request->user());

        return response()->json([
            'data' => $rows->getCollection()->map(fn ($row) => [
                'id' => $row->id,
                'device_type' => $row->device_type,
                'activity_type' => $row->activity_type,
                'distance_km' => (float) $row->distance_km,
                'duration_min' => (float) $row->duration_min,
                'avg_heart_rate' => $row->avg_heart_rate,
                'max_heart_rate' => $row->max_heart_rate,
                'weight_kg' => (float) $row->weight_kg,
                'height_cm' => $row->height_cm ? (float) $row->height_cm : null,
                'age' => $row->age,
                'sex' => $row->sex,
                'measured_calories' => (float) $row->measured_calories,
                'trana_estimated_calories' => $row->trana_estimated_calories ? (int) $row->trana_estimated_calories : null,
                'calibration_factor' => $factor,
                'recorded_at' => $row->recorded_at?->toIso8601String(),
            ])->values(),
            'meta' => [
                'current_page' => $rows->currentPage(),
                'last_page' => $rows->lastPage(),
                'per_page' => $rows->perPage(),
                'total' => $rows->total(),
            ],
        ]);
    }

    /**
     * Record a wearable energy expenditure entry.
     * Used to import datasets (e.g. WEEE) or sync wearable data.
     */
    public function store(StoreEnergyExpenditureRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $entry = $request->user()->energyExpenditure()->create([
            'device_type' => $validated['device_type'],
            'activity_type' => $validated['activity_type'],
            'distance_km' => $validated['distance_km'],
            'duration_min' => $validated['duration_min'],
            'avg_heart_rate' => $validated['avg_heart_rate'] ?? null,
            'max_heart_rate' => $validated['max_heart_rate'] ?? null,
            'weight_kg' => $validated['weight_kg'],
            'height_cm' => $validated['height_cm'] ?? null,
            'age' => $validated['age'] ?? null,
            'sex' => $validated['sex'] ?? null,
            'measured_calories' => $validated['measured_calories'],
            'trana_estimated_calories' => app(\App\Services\ActivityService::class)
                ->estimateCalories(
                    $validated['activity_type'],
                    (float) $validated['distance_km'],
                    (float) $validated['duration_min'],
                    0,
                    (float) $validated['weight_kg'],
                ),
            'recorded_at' => $validated['recorded_at'],
        ]);

        return response()->json([
            'data' => [
                'id' => $entry->id,
                'measured_calories' => (float) $entry->measured_calories,
                'trana_estimated_calories' => $entry->trana_estimated_calories ? (int) $entry->trana_estimated_calories : null,
                'calibration_factor' => $this->calibration->calculateFactor($request->user()),
            ],
        ], 201);
    }

    /**
     * Get the current calibration factor for the authenticated user.
     */
    public function calibration(Request $request): JsonResponse
    {
        return response()->json([
            'data' => [
                'calibration_factor' => $this->calibration->calculateFactor($request->user()),
                'sample_count' => EnergyExpenditure::forUser($request->user()->id)
                    ->withMeasured()
                    ->count(),
                'min_samples' => EnergyExpenditureCalibrationService::MIN_SAMPLES,
            ],
        ]);
    }
}
