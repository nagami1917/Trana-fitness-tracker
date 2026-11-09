<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreRouteRequest;
use App\Http\Resources\PlannedRouteResource;
use App\Models\PlannedRoute;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RouteController extends Controller
{
    /**
     * List the authenticated athlete's planned routes.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $routes = PlannedRoute::forUser($request->user()->id)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate($validated['limit'] ?? 30, ['*'], 'page', $validated['page'] ?? 1);

        return response()->json([
            'data' => PlannedRouteResource::collection($routes->getCollection())->toArray($request),
            'meta' => [
                'current_page' => $routes->currentPage(),
                'last_page' => $routes->lastPage(),
                'per_page' => $routes->perPage(),
                'total' => $routes->total(),
            ],
        ]);
    }

    /**
     * Save a planned route with its GeoJSON geometry.
     */
    public function store(StoreRouteRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $route = $request->user()->plannedRoutes()->create([
            'user_id' => $request->user()->id,
            'name' => $validated['name'],
            'distance_km' => $validated['distance_km'],
            'estimated_duration_min' => $validated['estimated_duration_min'],
            'elevation_gain_m' => $validated['elevation_gain_m'] ?? 0,
            'route_geojson' => $validated['route_geojson'] ?? null,
        ]);

        if (! empty($validated['route_geojson'])) {
            $this->seedRoutePoints($route, $validated['route_geojson']);
        }

        return response()->json([
            'data' => (new PlannedRouteResource($route->fresh(['routePoints'])))->toArray($request),
        ], 201);
    }

    /**
     * Show one planned route (owner only).
     */
    public function show(Request $request, PlannedRoute $route): JsonResponse
    {
        abort_unless($route->user_id === $request->user()->id, 404);

        return response()->json([
            'data' => (new PlannedRouteResource($route->load('routePoints')))->toArray($request),
        ]);
    }

    /**
     * Persist the vertices of a GeoJSON LineString/FeatureCollection as
     * denormalised route points so the map can render without re-parsing JSON.
     */
    private function seedRoutePoints(PlannedRoute $route, array $geojson): void
    {
        $coordinates = $this->extractCoordinates($geojson);
        if ($coordinates === []) {
            return;
        }

        $points = array_map(fn (array $point, int $sequence) => [
            'latitude' => (float) $point[0],
            'longitude' => (float) $point[1],
            'altitude' => $point[2] ?? null,
            'sequence' => $sequence,
        ], $coordinates, range(1, count($coordinates)));

        $route->routePoints()->createMany($points);
    }

    /**
     * Pull [lat, lng, ...] coordinates out of common GeoJSON structures.
     * Returns [] when nothing usable is found.
     */
    private function extractCoordinates(array $geojson): array
    {
        $collect = function (array $geometry, array &$out): void {
            if (! isset($geometry['type']) || ! isset($geometry['coordinates'])) {
                return;
            }
            match ($geometry['type']) {
                'Point' => $out[] = $geometry['coordinates'],
                'LineString' => $out = array_merge($out, $geometry['coordinates']),
                'MultiLineString' => array_walk($geometry['coordinates'], fn ($line) => $out = array_merge($out, $line)),
                default => null,
            };
        };

        $out = [];
        if (($geojson['type'] ?? null) === 'FeatureCollection') {
            foreach ($geojson['features'] ?? [] as $feature) {
                $collect($feature['geometry'] ?? [], $out);
            }
        } elseif (($geojson['type'] ?? null) === 'Feature') {
            $collect($geojson['geometry'] ?? [], $out);
        } else {
            $collect($geojson, $out);
        }

        // GeoJSON stores [lon, lat]; the app works in [lat, lng].
        return array_map(fn (array $coord) => [ (float) $coord[1], (float) $coord[0] ], $out);
    }
}
