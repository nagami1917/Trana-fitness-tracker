<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ErrorMonitor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Ingest for browser-side faults (and ML-service forwards). Public by
 * design — an error can happen before login — and rate-limited per IP.
 * Payloads are clipped server-side; nothing here is ever echoed back.
 */
class ErrorReportController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'message' => ['required', 'string', 'max:1000'],
            'stack' => ['nullable', 'string', 'max:8000'],
            'route' => ['nullable', 'string', 'max:200'],
            'kind' => ['nullable', 'in:client,ml'],
            'app_version' => ['nullable', 'string', 'max:40'],
        ]);

        $validated['kind'] ??= 'client';

        ErrorMonitor::recordReport($validated, $request->user()?->id);

        // Accepted regardless of grouping outcome: reporting must never
        // surface an error to the reporter itself.
        return response()->json(['status' => 'accepted'], 202);
    }
}
