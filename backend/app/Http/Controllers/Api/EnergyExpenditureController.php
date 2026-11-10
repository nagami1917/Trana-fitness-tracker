<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\ImportEnergyExpenditureRequest;
use App\Http\Resources\EnergyExpenditureResource;
use App\Services\EnergyExpenditureService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EnergyExpenditureController extends Controller
{
    public function __construct(private readonly EnergyExpenditureService $energy)
    {
    }

    /** The athlete's imported samples, newest session first. */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'device' => ['nullable', 'string', 'max:32'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $samples = $request->user()->energyExpenditure()
            ->forDevice($validated['device'] ?? null)
            ->orderByDesc('recorded_at')
            ->limit($validated['limit'] ?? 200)
            ->get();

        return response()->json([
            'data' => EnergyExpenditureResource::collection($samples),
            'calibration' => $this->energy->calibration($request->user()),
        ]);
    }

    /** Import a batch of device-reported sessions. */
    public function store(ImportEnergyExpenditureRequest $request): JsonResponse
    {
        $result = $this->energy->importBatch($request->user(), $request->validated()['entries']);

        return response()->json(['data' => $result], 201);
    }

    /** The athlete's current calibration factor and sample count. */
    public function calibration(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->energy->calibration($request->user())]);
    }
}
