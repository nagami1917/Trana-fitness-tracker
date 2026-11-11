<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GoalEvent;
use App\Models\InAppNotification;
use App\Models\Prediction;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class NotificationController extends Controller
{
    /**
     * Goal labels/units mirrored from the Goals page (frontend GOAL_META) so
     * reminder bodies read the same everywhere.
     */
    private const GOAL_LABELS = [
        'daily_calories' => ['Calories burned', 'kcal', 0],
        'daily_distance_km' => ['Distance', 'km', 1],
        'daily_active_min' => ['Active time', 'min', 0],
        'weekly_calories' => ['Weekly energy', 'kcal', 0],
        'weekly_distance_km' => ['Weekly distance', 'km', 1],
    ];

    /**
     * Notification center feed. Before listing, reminders are synthesized from
     * existing data (plans scheduled for today, goals reached today) — each
     * with a per-user dedupe key so repeat fetches never duplicate rows.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->synthesize($user);

        $items = InAppNotification::where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(50)
            ->get()
            ->map(fn (InAppNotification $notification) => [
                'id' => $notification->id,
                'type' => $notification->type,
                'title' => $notification->title,
                'body' => $notification->body,
                'read_at' => $notification->read_at?->toIso8601String(),
                'created_at' => $notification->created_at?->toIso8601String(),
            ]);

        $unread = InAppNotification::where('user_id', $user->id)
            ->whereNull('read_at')
            ->count();

        return response()->json([
            'data' => $items,
            'meta' => ['unread' => $unread],
        ]);
    }

    /** Mark one of the athlete's notifications as read (404 otherwise). */
    public function markRead(Request $request, InAppNotification $notification): JsonResponse
    {
        if ($notification->user_id !== $request->user()->id) {
            abort(404);
        }

        if (! $notification->read_at) {
            $notification->update(['read_at' => now()]);
        }

        return response()->json(['message' => 'Marked as read.']);
    }

    /** Clear the badge — mark every unread notification as read. */
    public function markAllRead(Request $request): JsonResponse
    {
        InAppNotification::where('user_id', $request->user()->id)
            ->whereNull('read_at')
            ->update(['read_at' => now()]);

        return response()->json(['message' => 'All caught up.']);
    }

    /**
     * Derive reminders from what already exists — no cron, no queue:
     *  · plan_today:   predictions scheduled for today, still `planned`
     *  · goal_reached: achievements recorded today (goal history rows)
     */
    private function synthesize(User $user): void
    {
        $today = Carbon::today();

        $plans = Prediction::where('user_id', $user->id)
            ->where('status', 'planned')
            ->whereNotNull('planned_for')
            ->whereBetween('planned_for', [$today, $today->copy()->addDay()])
            ->get(['id', 'activity_type', 'distance_km', 'planned_for']);

        foreach ($plans as $plan) {
            InAppNotification::insertOrIgnore([
                'user_id' => $user->id,
                'type' => 'plan_today',
                'dedupe_key' => 'plan:'.$plan->id.':'.$today->toDateString(),
                'title' => 'Planned today',
                'body' => ucfirst($plan->activity_type).' · '.number_format((float) $plan->distance_km, 1)
                    .' km planned for '.$plan->planned_for->format('g A'),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $events = GoalEvent::where('user_id', $user->id)
            ->whereDate('date', $today)
            ->orderByDesc('id')
            ->limit(20)
            ->get(['id', 'goal_key', 'target', 'achieved_value']);

        foreach ($events as $event) {
            [$label, $unit, $decimals] = self::GOAL_LABELS[$event->goal_key]
                ?? [str_replace('_', ' ', $event->goal_key), '', 0];

            InAppNotification::insertOrIgnore([
                'user_id' => $user->id,
                'type' => 'goal_reached',
                'dedupe_key' => 'goal:'.$event->id,
                'title' => 'Goal reached 🎯',
                'body' => $label.' · '.number_format((float) $event->achieved_value, $decimals)
                    .' / '.number_format((float) $event->target, $decimals).' '.$unit,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
}
