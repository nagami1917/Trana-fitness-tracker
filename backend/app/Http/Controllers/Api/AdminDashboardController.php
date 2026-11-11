<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\ErrorLog;
use App\Models\Goal;
use App\Models\Prediction;
use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * Admin KPI dashboard — aggregate counts only. Deliberately free of any
 * per-athlete content: the console shows operational health, not data.
 */
class AdminDashboardController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json([
            'data' => [
                'users' => [
                    'total' => User::count(),
                    'new_7d' => User::where('created_at', '>=', now()->subDays(7))->count(),
                    'suspended' => User::whereNotNull('suspended_at')->count(),
                    'admins' => User::where('role', User::ROLE_ADMIN)->count(),
                ],
                'content' => [
                    'activities' => Activity::count(),
                    'predictions' => Prediction::count(),
                    'goals' => Goal::count(),
                ],
                'errors' => [
                    'open_groups' => ErrorLog::where('status', 'open')->count(),
                    'groups_24h' => ErrorLog::where('last_seen_at', '>=', now()->subDay())->count(),
                    'total_groups' => ErrorLog::count(),
                ],
            ],
        ]);
    }
}
