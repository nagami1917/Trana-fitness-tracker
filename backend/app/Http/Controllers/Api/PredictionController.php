<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StorePredictionRequest;
use App\Models\Prediction;
use App\Services\MlClient;
use App\Services\PredictionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

class PredictionController extends Controller
{
    public function __construct(
        private readonly PredictionService $predictions,
        private readonly MlClient $ml,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['nullable', 'in:planned,completed,cancelled'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $rows = $request->user()->predictions()
            ->when($validated['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->orderByDesc('created_at')
            ->limit($validated['limit'] ?? 30)
            ->get();

        return response()->json(['data' => $rows->map(fn (Prediction $p) => $p->toApiArray())->values()]);
    }

    public function store(StorePredictionRequest $request): JsonResponse
    {
        try {
            $prediction = $this->predictions->create($request->user(), $request->validated());
        } catch (RuntimeException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'hint' => 'The Svelte PWA can still predict locally while the ML service is offline.',
            ], 503);
        }

        return response()->json(['data' => $prediction->fresh()->toApiArray()], 201);
    }

    public function show(Request $request, Prediction $prediction): JsonResponse
    {
        abort_unless($prediction->user_id === $request->user()->id, 404);

        return response()->json(['data' => $prediction->toApiArray()]);
    }

    public function destroy(Request $request, Prediction $prediction): JsonResponse
    {
        abort_unless($prediction->user_id === $request->user()->id, 404);
        $prediction->delete();

        return response()->json(['deleted' => true]);
    }

    /** Preview a prediction without persisting it. */
    public function preview(StorePredictionRequest $request): JsonResponse
    {
        try {
            // distance_km may be omitted when a route is drawn; resolve the
            // effective distance the same way PredictionService does, because
            // the ML service rejects distance_km <= 0.
            $distance = (float) ($request->input('distance_km') ?? 0);
            $route = $request->input('route');
            if ($distance <= 0 && is_array($route) && count($route) > 1) {
                $distance = $this->predictions->routeLengthKm($route);
            }

            $result = $this->ml->predict([
                'activity_type' => $request->input('activity_type'),
                'distance_km' => $distance,
                'elevation_gain_m' => (float) $request->input('elevation_gain_m', 0),
                'weight_kg' => (float) ($request->user()->fitnessProfile?->weight_kg ?? 60),
                'experience_level' => (int) ($request->user()->fitnessProfile?->experience_level ?? 3),
                'sweat_profile' => $request->user()->fitnessProfile?->sweat_profile ?? 'normal',
                'temperature_c' => (float) $request->input('temperature_c', 26),
                'history' => $this->predictions->history($request->user()),
            ]);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 503);
        }

        return response()->json(['data' => $result]);
    }

    /** Model card for the analytics screen. */
    public function model(): JsonResponse
    {
        return response()->json(['data' => $this->ml->modelInfo()]);
    }
}
