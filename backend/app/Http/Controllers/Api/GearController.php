<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Gear;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class GearController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $items = $request->user()->gear()
            ->orderBy('retired')
            ->orderByDesc('is_default')
            ->orderByDesc('id')
            ->get()
            ->map(fn (Gear $item) => $this->format($item));

        return response()->json(['data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'brand' => ['nullable', 'string', 'max:60'],
            'sport' => ['required', Rule::in(Gear::SPORTS)],
            'initial_km' => ['nullable', 'numeric', 'min:0', 'max:100000'],
            'max_km' => ['nullable', 'numeric', 'min:50', 'max:100000'],
            'is_default' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $user = $request->user();
        $isDefault = (bool) ($validated['is_default'] ?? false);
        if ($isDefault) {
            $user->gear()->where('sport', $validated['sport'])->update(['is_default' => false]);
        }

        $gear = $user->gear()->create([
            'name' => $validated['name'],
            'brand' => $validated['brand'] ?? null,
            'sport' => $validated['sport'],
            'initial_km' => round((float) ($validated['initial_km'] ?? 0), 2),
            'logged_km' => 0,
            'max_km' => round((float) ($validated['max_km'] ?? 650), 2),
            'is_default' => $isDefault,
            'retired' => false,
            'notes' => $validated['notes'] ?? null,
        ]);

        return response()->json(['data' => $this->format($gear)], 201);
    }

    public function update(Request $request, Gear $gear): JsonResponse
    {
        abort_unless($gear->user_id === $request->user()->id, 404);

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:80'],
            'brand' => ['sometimes', 'nullable', 'string', 'max:60'],
            'sport' => ['sometimes', 'required', Rule::in(Gear::SPORTS)],
            'initial_km' => ['sometimes', 'numeric', 'min:0', 'max:100000'],
            'max_km' => ['sometimes', 'numeric', 'min:50', 'max:100000'],
            'is_default' => ['sometimes', 'boolean'],
            'retired' => ['sometimes', 'boolean'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        if (! empty($validated['is_default'])) {
            $sport = $validated['sport'] ?? $gear->sport;
            $request->user()->gear()
                ->where('sport', $sport)
                ->where('id', '!=', $gear->id)
                ->update(['is_default' => false]);
        }

        $gear->update($validated);

        return response()->json(['data' => $this->format($gear->fresh())]);
    }

    public function destroy(Request $request, Gear $gear): JsonResponse
    {
        abort_unless($gear->user_id === $request->user()->id, 404);
        $gear->delete();

        return response()->json(['deleted' => true]);
    }

    private function format(Gear $gear): array
    {
        $total = $gear->totalKm();
        $max = max(1.0, (float) $gear->max_km);

        return [
            'id' => $gear->id,
            'name' => $gear->name,
            'brand' => $gear->brand,
            'sport' => $gear->sport,
            'initial_km' => (float) $gear->initial_km,
            'logged_km' => (float) $gear->logged_km,
            'total_km' => $total,
            'max_km' => (float) $gear->max_km,
            'wear_pct' => (int) min(100, round(($total / $max) * 100)),
            'is_default' => (bool) $gear->is_default,
            'retired' => (bool) $gear->retired,
            'notes' => $gear->notes,
        ];
    }
}
