<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PushSubscription;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PushSubscriptionController extends Controller
{
    public const DEFAULT_PREFERENCES = [
        'pre_workout_fueling' => true,
        'lead_hours' => 3,
        'post_workout_recovery' => true,
        'gear_wear_alerts' => true,
        'race_carb_loading' => true,
    ];

    public function show(Request $request): JsonResponse
    {
        $subs = $request->user()->pushSubscriptions()->orderByDesc('id')->get();
        $first = $subs->first();

        return response()->json([
            'data' => [
                'subscribed' => $subs->isNotEmpty(),
                'count' => $subs->count(),
                'preferences' => array_merge(self::DEFAULT_PREFERENCES, $first?->preferences ?? []),
            ],
        ]);
    }

    public function subscribe(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'endpoint' => ['required', 'string', 'max:2000'],
            'public_key' => ['nullable', 'string', 'max:255'],
            'auth_token' => ['nullable', 'string', 'max:255'],
            'preferences' => ['sometimes', 'array'],
            'preferences.pre_workout_fueling' => ['sometimes', 'boolean'],
            'preferences.lead_hours' => ['sometimes', 'integer', 'min:1', 'max:12'],
            'preferences.post_workout_recovery' => ['sometimes', 'boolean'],
            'preferences.gear_wear_alerts' => ['sometimes', 'boolean'],
            'preferences.race_carb_loading' => ['sometimes', 'boolean'],
        ]);

        $hash = hash('sha256', $validated['endpoint']);
        $prefs = array_merge(self::DEFAULT_PREFERENCES, $validated['preferences'] ?? []);

        $sub = PushSubscription::updateOrCreate(
            ['user_id' => $request->user()->id, 'endpoint_hash' => $hash],
            [
                'endpoint' => $validated['endpoint'],
                'public_key' => $validated['public_key'] ?? null,
                'auth_token' => $validated['auth_token'] ?? null,
                'preferences' => $prefs,
                'last_used_at' => now(),
            ],
        );

        return response()->json([
            'data' => [
                'id' => $sub->id,
                'subscribed' => true,
                'preferences' => $prefs,
            ],
        ], 201);
    }

    public function updatePreferences(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'pre_workout_fueling' => ['sometimes', 'boolean'],
            'lead_hours' => ['sometimes', 'integer', 'min:1', 'max:12'],
            'post_workout_recovery' => ['sometimes', 'boolean'],
            'gear_wear_alerts' => ['sometimes', 'boolean'],
            'race_carb_loading' => ['sometimes', 'boolean'],
        ]);

        $user = $request->user();
        $subs = $user->pushSubscriptions()->get();
        $base = $subs->first()?->preferences ?? self::DEFAULT_PREFERENCES;
        $merged = array_merge(self::DEFAULT_PREFERENCES, $base, $validated);

        foreach ($subs as $sub) {
            $sub->update(['preferences' => $merged]);
        }

        return response()->json([
            'data' => [
                'subscribed' => $subs->isNotEmpty(),
                'preferences' => $merged,
            ],
        ]);
    }

    public function unsubscribe(Request $request): JsonResponse
    {
        $endpoint = $request->input('endpoint');
        $query = $request->user()->pushSubscriptions();
        if (is_string($endpoint) && $endpoint !== '') {
            $query->where('endpoint_hash', hash('sha256', $endpoint));
        }
        $query->delete();

        return response()->json(['subscribed' => false]);
    }
}
