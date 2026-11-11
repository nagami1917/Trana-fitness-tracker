<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StorePredictionRequest;
use App\Http\Resources\PredictionResource;
use App\Models\Prediction;
use App\Services\ActivityService;
use App\Services\MlClient;
use App\Services\PredictionService;
use App\Services\RouteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class PredictionController extends Controller
{
    public function __construct(
        private readonly PredictionService $predictions,
        private readonly MlClient $ml,
        private readonly RouteService $routes,
        private readonly ActivityService $activities,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['nullable', 'in:planned,completed,cancelled'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $rows = $request->user()->predictions()
            ->when($validated['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate($validated['limit'] ?? 30, ['*'], 'page', $validated['page'] ?? 1);

        return response()->json([
            'data' => $rows->getCollection()->map(fn (Prediction $p) => (new PredictionResource($p))->toArray($request))->values(),
            'meta' => [
                'current_page' => $rows->currentPage(),
                'last_page' => $rows->lastPage(),
                'per_page' => $rows->perPage(),
                'total' => $rows->total(),
            ],
        ]);
    }

    public function store(StorePredictionRequest $request): JsonResponse
    {
        try {
            $prediction = $this->predictions->create($request->user(), $request->validated());
        } catch (RuntimeException $e) {
            // The operator needs the technical reason; the athlete needs to
            // know that this is a server-side outage and not their plan.
            Log::warning('Prediction save failed: '.$e->getMessage());

            return response()->json([
                'message' => 'The prediction service is unavailable, so this plan cannot be saved yet.',
                'hint' => 'A local preview may be available, but saving requires the prediction service.',
            ], 503);
        }

        return response()->json(['data' => (new PredictionResource($prediction->fresh()))->toArray($request)], 201);
    }

    public function show(Request $request, Prediction $prediction): JsonResponse
    {
        abort_unless($prediction->user_id === $request->user()->id, 404);

        return response()->json(['data' => (new PredictionResource($prediction))->toArray($request)]);
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
            $distance = $this->routes->effectiveContext([
                'distance_km' => $request->input('distance_km'),
                'route' => $request->input('route'),
            ])['distance_km'];

            // Same Step 4 profile context the saved-prediction path sends.
            $context = $request->user()->ensureProfile()->predictionContext();

            $result = $this->ml->predict([
                'activity_type' => $request->input('activity_type'),
                'distance_km' => $distance,
                'elevation_gain_m' => (float) $request->input('elevation_gain_m', 0),
                'weight_kg' => $context['weight_kg'],
                'experience_level' => $context['fitness_level'],
                'age' => $context['age'],
                'sex' => $context['sex'],
                'height_cm' => $context['height_cm'],
                'fitness_level' => $context['fitness_level'],
                'activity_experience' => $context['activity_experience'],
                'sweat_profile' => $request->input('sweat_profile') ?? $context['sweat_profile'],
                'temperature_c' => (float) $request->input('temperature_c', $context['typical_temperature_c']),
                'history' => $this->activities->history($request->user()),
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
