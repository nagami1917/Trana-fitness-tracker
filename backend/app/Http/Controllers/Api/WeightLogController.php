<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WeightLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class WeightLogController extends Controller
{
    /**
     * Body-weight history for the Analytics trend chart (newest first).
     * `days` window defaults to 180, clamped to 7–730.
     */
    public function index(Request $request): JsonResponse
    {
        $days = min(730, max(7, (int) $request->query('days', 180)));

        $logs = WeightLog::where('user_id', $request->user()->id)
            ->whereDate('measured_at', '>=', Carbon::today()->subDays($days))
            ->orderByDesc('measured_at')
            ->orderByDesc('id')
            ->limit(400)
            ->get()
            ->map(fn (WeightLog $log) => [
                'id' => $log->id,
                'weight_kg' => (float) $log->weight_kg,
                'measured_at' => $log->measured_at?->toDateString(),
            ]);

        return response()->json(['data' => $logs]);
    }

    /**
     * Log a weigh-in (upserts the day) and mirror it to the profile when it
     * is the newest date — predictions immediately use the fresh weight.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'weight_kg' => ['required', 'numeric', 'min:30', 'max:300'],
            'measured_at' => ['nullable', 'date', 'before_or_equal:today'],
        ]);

        $log = WeightLog::record(
            $request->user(),
            (float) $validated['weight_kg'],
            $validated['measured_at'] ?? null,
        );

        return response()->json([
            'data' => [
                'id' => $log->id,
                'weight_kg' => (float) $log->weight_kg,
                'measured_at' => $log->measured_at?->toDateString(),
            ],
        ], 201);
    }

    /** Delete one of the athlete's weigh-ins (404 otherwise). Profile keeps its last known weight. */
    public function destroy(Request $request, WeightLog $weightLog): JsonResponse
    {
        if ($weightLog->user_id !== $request->user()->id) {
            abort(404);
        }

        $weightLog->delete();

        return response()->json(['message' => 'Weigh-in deleted.']);
    }
}
