<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\StreamedResponse;
use Illuminate\Validation\ValidationException;

class AccountController extends Controller
{
    /**
     * Export the athlete's full activity history as CSV — "your data, yours".
     * Geometry (route points) is intentionally excluded to keep the file
     * human-readable; every training metric is included.
     */
    public function exportCsv(Request $request): StreamedResponse
    {
        $user = $request->user();
        $filename = 'trana-activities-'.$user->id.'-'.now()->format('Ymd-His').'.csv';

        return response()->streamDownload(function () use ($user) {
            $out = fopen('php://output', 'w');
            fputcsv($out, [
                'id', 'activity_type', 'started_at', 'distance_km', 'duration_min',
                'calories', 'elevation_gain_m', 'avg_heart_rate', 'source', 'notes',
            ], ',', '"', '\\');

            Activity::where('user_id', $user->id)
                ->orderByDesc('started_at')
                ->orderByDesc('id')
                ->cursor()
                ->each(function (Activity $activity) use ($out) {
                    fputcsv($out, [
                        $activity->id,
                        $activity->activity_type,
                        $activity->started_at?->toIso8601String(),
                        (string) $activity->distance_km,
                        (string) $activity->duration_min,
                        $activity->calories,
                        $activity->elevation_gain_m,
                        $activity->avg_heart_rate,
                        $activity->source,
                        $activity->notes,
                    ], ',', '"', '\\');
                });

            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    /**
     * Right to erasure: delete the account and everything tied to it.
     * The password is required so a stolen session alone cannot wipe data.
     * Child rows (activities, goals, goal_events, plans, sessions-foods…)
     * are removed by database-level ON DELETE CASCADE; auth tokens and
     * database sessions have no FK, so they are purged explicitly.
     */
    public function destroy(Request $request): JsonResponse
    {
        $request->validate([
            'password' => ['required', 'string'],
        ]);

        $user = $request->user();

        if (! Hash::check($request->input('password'), $user->password)) {
            throw ValidationException::withMessages([
                'password' => ['Password is incorrect.'],
            ]);
        }

        DB::transaction(function () use ($user) {
            $user->tokens()->delete();
            DB::table('sessions')->where('user_id', $user->id)->delete();
            $user->delete();
        });

        return response()->json(['message' => 'Account and all associated data have been deleted.']);
    }
}
