<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\ActivityController;
use App\Http\Controllers\Api\ActivityPointController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DailySessionController;
use App\Http\Controllers\Api\EmailVerificationController;
use App\Http\Controllers\Api\DailySessionFoodController;
use App\Http\Controllers\Api\EnergyExpenditureController;
use App\Http\Controllers\Api\GoalController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\PasswordRecoveryController;
use App\Http\Controllers\Api\PredictionController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\RouteController;
use App\Http\Controllers\Api\WeightLogController;
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

    // The prediction service is optional for reads but required to save a
    // plan. Reporting its state here makes a missing ML_API_URL visible up
    // front instead of surfacing as a failed save with no explanation.
    return response()->json([
        'status' => 'ok',
        'ml' => app(\App\Services\MlClient::class)->health(),
    ]);
});

Route::get('/docs', fn () => response()->json([
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
    ],
]));

Route::middleware('throttle:auth')->group(function () {
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/login', [AuthController::class, 'login']);

    // Password recovery — forgot sends the link, reset consumes the token.
    Route::post('/password/forgot', [PasswordRecoveryController::class, 'forgot']);
    Route::post('/password/reset', [PasswordRecoveryController::class, 'reset']);
});

// Signed verification link (from the email). Validates HMAC + expiry, marks
// the address verified, and redirects to the SPA — no session required.
Route::get('/email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
    ->middleware('throttle:auth')
    ->name('verification.verify');

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    // Resend the verification link for the signed-in athlete.
    Route::post('/email/verify/resend', [EmailVerificationController::class, 'resend'])
        ->middleware('throttle:6,1');

    // In-app notification center (reminders synthesized lazily on read).
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead'])
        ->middleware('throttle:writes');
    Route::post('/notifications/{notification}/read', [NotificationController::class, 'markRead'])
        ->middleware('throttle:writes');

    // Body-metrics timeline — daily weigh-ins feeding the Analytics chart.
    Route::get('/weight-logs', [WeightLogController::class, 'index']);
    Route::post('/weight-logs', [WeightLogController::class, 'store'])->middleware('throttle:writes');
    Route::delete('/weight-logs/{weightLog}', [WeightLogController::class, 'destroy'])
        ->middleware('throttle:writes');

    // Data rights: account erasure (password-confirmed) + full CSV export.
    Route::delete('/account', [AccountController::class, 'destroy'])->middleware('throttle:writes');

    // Step 4 — fitness profile: create, view, edit, update weight/level.
    Route::get('/profile', [ProfileController::class, 'show']);
    Route::post('/profile', [ProfileController::class, 'store'])->middleware('throttle:writes');
    Route::match(['put', 'patch'], '/profile', [ProfileController::class, 'update'])->middleware('throttle:writes');
    Route::patch('/profile/weight', [ProfileController::class, 'updateWeight'])->middleware('throttle:writes');
    Route::patch('/profile/fitness-level', [ProfileController::class, 'updateFitnessLevel'])->middleware('throttle:writes');

    Route::get('/activities/summary', [ActivityController::class, 'summary']);
    Route::get('/activities/export', [AccountController::class, 'exportCsv'])->middleware('throttle:writes');
    Route::apiResource('activities', ActivityController::class)->only(['index', 'show']);
    Route::post('/activities', [ActivityController::class, 'store'])->middleware('throttle:writes');
    Route::delete('/activities/{activity}', [ActivityController::class, 'destroy'])->middleware('throttle:writes');
    Route::post('/activities/{activity}/points', [ActivityPointController::class, 'store'])->middleware('throttle:writes');

    Route::apiResource('routes', RouteController::class)->only(['index', 'show']);
    Route::post('/routes', [RouteController::class, 'store'])->middleware('throttle:writes');

    // Wearable energy expenditure (e.g. WEEE dataset) for calorie calibration
    Route::get('/energy-expenditure', [EnergyExpenditureController::class, 'index']);
    Route::post('/energy-expenditure', [EnergyExpenditureController::class, 'store'])->middleware('throttle:writes');
    Route::get('/energy-expenditure/calibration', [EnergyExpenditureController::class, 'calibration']);

    Route::get('/goals', [GoalController::class, 'show']);
    Route::put('/goals', [GoalController::class, 'update'])->middleware('throttle:writes');
    Route::get('/goals/history', [GoalController::class, 'history']);

    // Daily sessions — daily progress tracking that resets at midnight
    Route::get('/daily-sessions/today', [DailySessionController::class, 'today']);
    Route::apiResource('daily-sessions', DailySessionController::class)->only(['index', 'show']);
    Route::match(['put', 'patch'], '/daily-sessions/{dailySession}', [DailySessionController::class, 'update'])->middleware('throttle:writes');
    Route::delete('/daily-sessions/{dailySession}', [DailySessionController::class, 'destroy'])->middleware('throttle:writes');

    // Daily session foods — breakfast, lunch, dinner, snack
    Route::post('/daily-sessions/{dailySession}/foods', [DailySessionFoodController::class, 'store'])->middleware('throttle:writes');
    Route::put('/daily-sessions/{dailySession}/foods/{dailySessionFood}', [DailySessionFoodController::class, 'update'])->middleware('throttle:writes');
    Route::delete('/daily-sessions/{dailySession}/foods/{dailySessionFood}', [DailySessionFoodController::class, 'destroy'])->middleware('throttle:writes');

    Route::middleware('throttle:predictions')->group(function () {
        Route::post('/predictions/preview', [PredictionController::class, 'preview']);
        Route::post('/predictions', [PredictionController::class, 'store']);
    });
    Route::get('/predictions', [PredictionController::class, 'index']);
    Route::get('/predictions/{prediction}', [PredictionController::class, 'show']);
    Route::delete('/predictions/{prediction}', [PredictionController::class, 'destroy']);

    Route::get('/model', [PredictionController::class, 'model']);

});
