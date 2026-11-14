<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\EmailOtpChallenge;
use App\Services\EmailOtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\StreamedResponse;
use Throwable;

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

    /** Send a fresh email code before the irreversible account deletion action. */
    public function requestDeletionCode(Request $request, EmailOtpService $otp): JsonResponse
    {
        $request->validate(['password' => ['prohibited']]);
        $user = $request->user();

        try {
            $sent = $otp->issue($user->email, $user->name, EmailOtpService::PURPOSE_ACCOUNT_DELETION);
        } catch (Throwable $exception) {
            Log::warning('Account deletion OTP delivery failed', [
                'user_id' => $user->id,
                'exception' => get_class($exception),
            ]);

            return response()->json([
                'message' => 'The email service could not send your code. Please try again later or contact support.',
            ], 503);
        }

        if (! $sent) {
            return response()->json([
                'message' => 'Please wait a minute before requesting another code.',
            ], 429);
        }

        return response()->json([
            'message' => 'A six-digit confirmation code was sent to your email. It expires in 10 minutes.',
        ], 202);
    }

    /**
     * Right to erasure: delete the account and everything tied to it.
     * A recent, one-time email code plus an explicit DELETE confirmation are
     * required; child rows cascade and auth tokens / sessions are purged.
     */
    public function destroy(Request $request, EmailOtpService $otp): JsonResponse
    {
        $request->validate([
            'code' => ['required', 'string', 'regex:/^[0-9]{6}$/'],
            'confirmation' => ['required', 'in:DELETE'],
            'password' => ['prohibited'],
        ]);

        $user = $request->user();
        $otp->verifyAccountDeletionCode($user->email, $request->input('code'));

        DB::transaction(function () use ($user) {
            $user->tokens()->delete();
            DB::table('sessions')->where('user_id', $user->id)->delete();
            $user->delete();
            EmailOtpChallenge::query()->where('email', $user->email)->delete();
        });

        return response()->json(['message' => 'Account and all associated data have been deleted.']);
    }
}
