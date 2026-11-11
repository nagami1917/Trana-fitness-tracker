<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\MlClient;
use Illuminate\Http\JsonResponse;

/**
 * Read-only model-ops viewer: what artifact is deployed, its metrics and
 * feature importances — served straight from the ML service. No reload,
 * no retrain, no configuration writes from this console (by design).
 */
class AdminModelController extends Controller
{
    public function __construct(private MlClient $ml)
    {
    }

    public function show(): JsonResponse
    {
        $info = $this->ml->modelInfo();

        $status = $info['status'] ?? null;
        if ($status === 'not_configured') {
            return response()->json(['message' => 'The ML service is not configured.'], 503);
        }
        if ($status === 'unavailable') {
            return response()->json(['message' => 'The ML service is unavailable.'], 503);
        }

        return response()->json(['data' => $info]);
    }
}
