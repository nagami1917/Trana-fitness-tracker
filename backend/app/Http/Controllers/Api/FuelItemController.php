<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FuelItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class FuelItemController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $items = $request->user()->fuelItems()
            ->orderBy('category')
            ->orderBy('id')
            ->get()
            ->map(fn (FuelItem $item) => $this->format($item));

        return response()->json(['data' => $items]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'category' => ['required', Rule::in(FuelItem::CATEGORIES)],
            'carbs_g' => ['nullable', 'numeric', 'min:0', 'max:250'],
            'sodium_mg' => ['nullable', 'integer', 'min:0', 'max:3000'],
            'fluid_ml' => ['nullable', 'integer', 'min:0', 'max:3000'],
            'calories' => ['nullable', 'integer', 'min:0', 'max:2000'],
            'serving_label' => ['nullable', 'string', 'max:40'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $carbs = (float) ($validated['carbs_g'] ?? 0);
        $item = $request->user()->fuelItems()->create([
            'name' => $validated['name'],
            'category' => $validated['category'],
            'carbs_g' => $carbs,
            'sodium_mg' => (int) ($validated['sodium_mg'] ?? 0),
            'fluid_ml' => (int) ($validated['fluid_ml'] ?? 0),
            'calories' => (int) ($validated['calories'] ?? round($carbs * 4)),
            'serving_label' => $validated['serving_label'] ?? 'serving',
            'is_active' => $validated['is_active'] ?? true,
        ]);

        return response()->json(['data' => $this->format($item)], 201);
    }

    public function update(Request $request, FuelItem $fuelItem): JsonResponse
    {
        abort_unless($fuelItem->user_id === $request->user()->id, 404);

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:80'],
            'category' => ['sometimes', 'required', Rule::in(FuelItem::CATEGORIES)],
            'carbs_g' => ['sometimes', 'numeric', 'min:0', 'max:250'],
            'sodium_mg' => ['sometimes', 'integer', 'min:0', 'max:3000'],
            'fluid_ml' => ['sometimes', 'integer', 'min:0', 'max:3000'],
            'calories' => ['sometimes', 'integer', 'min:0', 'max:2000'],
            'serving_label' => ['sometimes', 'string', 'max:40'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $fuelItem->update($validated);

        return response()->json(['data' => $this->format($fuelItem->fresh())]);
    }

    public function destroy(Request $request, FuelItem $fuelItem): JsonResponse
    {
        abort_unless($fuelItem->user_id === $request->user()->id, 404);
        $fuelItem->delete();

        return response()->json(['deleted' => true]);
    }

    private function format(FuelItem $item): array
    {
        return [
            'id' => $item->id,
            'name' => $item->name,
            'category' => $item->category,
            'carbs_g' => (float) $item->carbs_g,
            'sodium_mg' => (int) $item->sodium_mg,
            'fluid_ml' => (int) $item->fluid_ml,
            'calories' => (int) $item->calories,
            'serving_label' => $item->serving_label,
            'is_active' => (bool) $item->is_active,
        ];
    }
}
