<?php

use App\Http\Controllers\Api\ActivityController;
use App\Http\Controllers\Api\ActivityPointController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\GoalController;
use App\Http\Controllers\Api\PredictionController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\RouteController;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| TRANA REST API  (v1)
|--------------------------------------------------------------------------
| Token auth via Sanctum. The Svelte PWA sends `Authorization: Bearer …`.
| All routes are consumed through a single base URL (`VITE_API_BASE_URL`).
*/

// The SPA checks both the API and the configured database before loading data.
// Do not expose database exception messages or credentials to anonymous clients.
Route::get('/health', function () {
    try {
        DB::selectOne('select 1');
    } catch (\Throwable $exception) {
        return response()->json([
            'status' => 'unavailable',
            'message' => 'The API cannot reach its database. Check the backend database settings.',
        ], 503);
    }

    return response()->json(['status' => 'ok']);
});

Route::get('/docs', fn () => response()->json([
    'name' => 'TRANA API',
    'version' => '1.0.0',
    'endpoints' => [
        'POST /api/auth/register',
        'POST /api/auth/login',
        'GET  /api/health',
        'GET  /api/auth/me',
        'POST /api/auth/logout',
        'GET  /api/profile',
        'PUT  /api/profile',
        'GET  /api/activities',
        'POST /api/activities',
        'GET  /api/activities/{id}',
        'DEL  /api/activities/{id}',
        'GET  /api/activities/summary',
        'GET  /api/goals',
        'PUT  /api/goals',
        'GET  /api/predictions',
        'POST /api/predictions',
        'POST /api/predictions/preview',
        'GET  /api/predictions/{id}',
        'DEL  /api/predictions/{id}',
        'GET  /api/model',
    ],
]));

Route::middleware('throttle:auth')->group(function () {
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/login', [AuthController::class, 'login']);
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    Route::get('/profile', [ProfileController::class, 'show']);
    Route::put('/profile', [ProfileController::class, 'update']);

    Route::get('/activities/summary', [ActivityController::class, 'summary']);
    Route::apiResource('activities', ActivityController::class)->only(['index', 'store', 'show', 'destroy']);
    Route::post('/activities/{activity}/points', [ActivityPointController::class, 'store']);

    Route::apiResource('routes', RouteController::class)->only(['index', 'store', 'show']);

    Route::get('/goals', [GoalController::class, 'show']);
    Route::put('/goals', [GoalController::class, 'update']);

    Route::middleware('throttle:predictions')->group(function () {
        Route::post('/predictions/preview', [PredictionController::class, 'preview']);
        Route::post('/predictions', [PredictionController::class, 'store']);
    });
    Route::get('/predictions', [PredictionController::class, 'index']);
    Route::get('/predictions/{prediction}', [PredictionController::class, 'show']);
    Route::delete('/predictions/{prediction}', [PredictionController::class, 'destroy']);

    Route::get('/model', [PredictionController::class, 'model']);

});
