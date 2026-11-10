<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDailySessionRequest;
use App\Http\Resources\DailySessionResource;
use App\Models\DailySession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DailySessionController extends Controller
{
    /** List the authenticated user's daily sessions. */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:365'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = DailySession::forUser($request->user()->id)
            ->when($validated['from'] ?? null, fn ($q, $from) => $q->where('session_date', '>=', $from))
            ->when($validated['to'] ?? null, fn ($q, $to) => $q->where('session_date', '<=', $to))
            ->orderByDesc('session_date');

        $sessions = $query->paginate($validated['limit'] ?? 30, ['*'], 'page', $validated['page'] ?? 1);

        return response()->json([
            'data' => DailySessionResource::collection($sessions->getCollection())->toArray($request),
            'meta' => [
                'current_page' => $sessions->currentPage(),
                'last_page' => $sessions->lastPage(),
                'per_page' => $sessions->perPage(),
                'total' => $sessions->total(),
            ],
        ]);
    }

    /** Get or create today's daily session. */
    public function today(Request $request): JsonResponse
    {
        $today = now()->timezone(config('app.timezone', 'UTC'))->format('Y-m-d');

        $session = DailySession::forUser($request->user()->id)
            ->forDate($today)
            ->with('foods')
            ->first();

        if ($request->isMethod('post')) {
            $validated = $request->validate([
                'calories_burned' => ['nullable', 'integer', 'min:0', 'max:50000'],
                'calories_eaten' => ['nullable', 'integer', 'min:0', 'max:50000'],
                'water_ml' => ['nullable', 'integer', 'min:0', 'max:20000'],
                'notes' => ['nullable', 'string', 'max:2000'],
            ]);

            $session = DailySession::updateOrCreate(
                ['user_id' => $request->user()->id, 'session_date' => $today],
                [
                    'calories_burned' => $validated['calories_burned'] ?? 0,
                    'calories_eaten' => $validated['calories_eaten'] ?? 0,
                    'water_ml' => $validated['water_ml'] ?? 0,
                    'notes' => $validated['notes'] ?? null,
                ]
            )->load('foods');

            return response()->json(['data' => new DailySessionResource($session)], 201);
        }

        if (!$session) {
            return response()->json([
                'data' => null,
                'message' => 'No session for today yet. Start tracking or log food.',
            ]);
        }

        return response()->json(['data' => new DailySessionResource($session)]);
    }

    /** Show one daily session with all foods. */
    public function show(Request $request, DailySession $dailySession): JsonResponse
    {
        abort_unless($dailySession->user_id === $request->user()->id, 404);

        return response()->json([
            'data' => new DailySessionResource($dailySession->load('foods')),
        ]);
    }

    /** Update a daily session (calories burned/eaten, water, notes). */
    public function update(Request $request, DailySession $dailySession): JsonResponse
    {
        abort_unless($dailySession->user_id === $request->user()->id, 404);

        $validated = $request->validate([
            'calories_burned' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'calories_eaten' => ['nullable', 'integer', 'min:0', 'max:50000'],
            'water_ml' => ['nullable', 'integer', 'min:0', 'max:20000'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $dailySession->update($validated);

        return response()->json([
            'data' => new DailySessionResource($dailySession->load('foods')),
        ]);
    }

    /** Delete a daily session and all its foods. */
    public function destroy(Request $request, DailySession $dailySession): JsonResponse
    {
        abort_unless($dailySession->user_id === $request->user()->id, 404);

        $dailySession->delete();

        return response()->json(['deleted' => true]);
    }
}
