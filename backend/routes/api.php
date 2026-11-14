<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\ActivityController;
use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\AdminErrorLogController;
use App\Http\Controllers\Api\AdminModelController;
use App\Http\Controllers\Api\AdminUserController;
use App\Http\Controllers\Api\ActivityPointController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DailySessionController;
use App\Http\Controllers\Api\ErrorReportController;
use App\Http\Controllers\Api\DailySessionFoodController;
use App\Http\Controllers\Api\EnergyExpenditureController;
use App\Http\Controllers\Api\FuelItemController;
use App\Http\Controllers\Api\GearController;
use App\Http\Controllers\Api\GoalController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\PredictionController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\PushSubscriptionController;
use App\Http\Controllers\Api\RaceEventController;
use App\Http\Controllers\Api\RouteController;
use App\Http\Controllers\Api\SystemController;
use App\Http\Controllers\Api\WeightLogController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| TRANA REST API  (v1)
|--------------------------------------------------------------------------
| Sanctum tokens are carried in HttpOnly cookies for browser auth; bearer
| tokens remain supported for trusted non-browser API clients. All routes are
| consumed through `VITE_API_BASE_URL`.
*/

// The SPA checks both the API and the configured database before loading data.
// Do not expose database exception messages or credentials to anonymous clients.
Route::get('/health', [SystemController::class, 'health']);

Route::get('/docs', [SystemController::class, 'docs']);

// Public intake for browser-side faults (and ML-service forwards).
// Unauthenticated by design — errors happen before login — but throttled.
Route::post('/client-errors', [ErrorReportController::class, 'store'])
    ->middleware('throttle:errors');

Route::middleware('throttle:auth')->group(function () {
    Route::get('/auth/csrf', [AuthController::class, 'csrf']);
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/email/verify', [AuthController::class, 'verifyEmail']);
    Route::post('/auth/email/resend', [AuthController::class, 'resendVerification']);
    Route::post('/auth/login', [AuthController::class, 'login']);
    Route::post('/auth/password/forgot', [AuthController::class, 'forgotPassword']);
    Route::post('/auth/password/reset', [AuthController::class, 'resetPassword']);
});

// Authenticated surface. `ensure.active` re-checks the suspension flag on
// every request — a suspended token dies here even if login was bypassed.
Route::middleware(['auth:sanctum', 'ensure.active', 'ensure.verified'])->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

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

    // Data rights: email-OTP-confirmed account erasure + full CSV export.
    Route::post('/account/delete-code', [AccountController::class, 'requestDeletionCode'])
        ->middleware('throttle:6,1');
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
    Route::match(['put', 'patch'], '/activities/{activity}', [ActivityController::class, 'update'])->middleware('throttle:writes');
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

    // Custom race-day fuel items & kit builder
    Route::get('/fuel-items', [FuelItemController::class, 'index']);
    Route::post('/fuel-items', [FuelItemController::class, 'store'])->middleware('throttle:writes');
    Route::match(['put', 'patch'], '/fuel-items/{fuelItem}', [FuelItemController::class, 'update'])->middleware('throttle:writes');
    Route::delete('/fuel-items/{fuelItem}', [FuelItemController::class, 'destroy'])->middleware('throttle:writes');

    // Gear / shoes mileage tracking
    Route::get('/gear', [GearController::class, 'index']);
    Route::post('/gear', [GearController::class, 'store'])->middleware('throttle:writes');
    Route::match(['put', 'patch'], '/gear/{gear}', [GearController::class, 'update'])->middleware('throttle:writes');
    Route::delete('/gear/{gear}', [GearController::class, 'destroy'])->middleware('throttle:writes');

    // Target race events & carb-loading calendar
    Route::get('/race-events', [RaceEventController::class, 'index']);
    Route::post('/race-events', [RaceEventController::class, 'store'])->middleware('throttle:writes');
    Route::match(['put', 'patch'], '/race-events/{raceEvent}', [RaceEventController::class, 'update'])->middleware('throttle:writes');
    Route::delete('/race-events/{raceEvent}', [RaceEventController::class, 'destroy'])->middleware('throttle:writes');

    // Web Push notification subscriptions & smart reminder preferences
    Route::get('/push/subscription', [PushSubscriptionController::class, 'show']);
    Route::post('/push/subscribe', [PushSubscriptionController::class, 'subscribe'])->middleware('throttle:writes');
    Route::put('/push/preferences', [PushSubscriptionController::class, 'updatePreferences'])->middleware('throttle:writes');
    Route::delete('/push/unsubscribe', [PushSubscriptionController::class, 'unsubscribe'])->middleware('throttle:writes');

    // Daily sessions — daily progress tracking that resets at midnight
    Route::get('/daily-sessions/today', [DailySessionController::class, 'today']);
    Route::post('/daily-sessions/today', [DailySessionController::class, 'today'])->middleware('throttle:writes');
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

    // ---------------------------------------------------------------- admin
    // Tier-1 console. EVERY endpoint sits behind the `admin` middleware —
    // role checks are server-side only; the SPA's nav gating is cosmetic.
    Route::middleware('admin')->prefix('admin')->group(function () {
        // Scalar ids, resolved inside the controllers: implicit model binding
        // would run BEFORE this group's middleware and leak id existence
        // (404 vs 403) to non-admins.
        Route::get('/dashboard', [AdminDashboardController::class, 'show']);
        Route::get('/users', [AdminUserController::class, 'index']);
        Route::patch('/users/{userId}/suspend', [AdminUserController::class, 'suspend']);
        Route::patch('/users/{userId}/reactivate', [AdminUserController::class, 'reactivate']);
        Route::get('/model', [AdminModelController::class, 'show']);
        Route::get('/errors', [AdminErrorLogController::class, 'index']);
        Route::patch('/errors/{errorId}', [AdminErrorLogController::class, 'update']);
    });
});
