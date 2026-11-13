<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class SystemController extends Controller
{
    public function root(): JsonResponse
    {
        return response()->json([
            'name' => 'TRANA API',
            'status' => 'ok',
            'docs' => '/api/docs',
            'version' => '1.0.0',
        ]);
    }

    public function health(): JsonResponse
    {
        try {
            DB::selectOne('select 1');
        } catch (\Throwable $exception) {
            return response()->json([
                'status' => 'unavailable',
                'message' => 'The API cannot reach its database. Check the backend database settings.',
            ], 503);
        }

        return response()->json(['status' => 'ok']);
    }

    public function docs(): JsonResponse
    {
        return response()->json([
            'name' => 'TRANA API',
            'version' => '1.0.0',
            'endpoints' => [
                'POST /api/auth/register',
                'POST /api/auth/login',
                'POST /api/password/forgot',
                'POST /api/password/reset',
                'POST /api/email/verify/resend',
                'GET  /api/email/verify/{id}/{hash}  (signed)',
                'GET  /api/notifications',
                'POST /api/notifications/read-all',
                'POST /api/notifications/{id}/read',
                'GET  /api/weight-logs',
                'POST /api/weight-logs',
                'DEL  /api/weight-logs/{id}',
                'GET  /api/health',
                'GET  /api/auth/me',
                'POST /api/auth/logout',
                'GET  /api/profile',
                'POST /api/profile',
                'PUT  /api/profile',
                'PATCH /api/profile',
                'PATCH /api/profile/weight',
                'PATCH /api/profile/fitness-level',
                'GET  /api/activities',
                'POST /api/activities',
                'GET  /api/activities/{id}',
                'DEL  /api/activities/{id}',
                'GET  /api/activities/summary',
                'GET  /api/activities/export',
                'DEL  /api/account',
                'GET  /api/goals',
                'PUT  /api/goals',
                'GET  /api/goals/history',
                'GET  /api/predictions',
                'POST /api/predictions',
                'POST /api/predictions/preview',
                'GET  /api/predictions/{id}',
                'DEL  /api/predictions/{id}',
                'GET  /api/model',
                'POST /api/client-errors',
                'GET  /api/admin/dashboard',
                'GET  /api/admin/users?q=&status=',
                'PAT  /api/admin/users/{id}/suspend',
                'PAT  /api/admin/users/{id}/reactivate',
                'GET  /api/admin/model',
                'GET  /api/admin/errors?status=&kind=',
                'PAT  /api/admin/errors/{id}',
            ],
        ]);
    }
}
