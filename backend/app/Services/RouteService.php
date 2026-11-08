<?php

namespace App\Services;

/**
 * Route math for drawn polylines: validation, haversine length, and the
 * "drawn route wins over typed distance" rule used by the prediction flow.
 */
class RouteService
{
    /**
     * Resolve the effective distance for an input payload.
     *
     * @param  array{distance_km?:mixed, route?:mixed}  $input
     * @return array{distance_km: float, route: ?array<int, array{0: float, 1: float}>}
     */
    public function effectiveContext(array $input): array
    {
        $route = $this->normalize($input['route'] ?? null);
        $distance = (float) ($input['distance_km'] ?? 0);

        if ($route !== null && count($route) > 1) {
            // The drawn route wins — measured, not typed.
            $distance = $this->routeLengthKm($route);
        }

        return ['distance_km' => $distance, 'route' => $route];
    }

    /** Normalise a raw route input into [[lat, lng], …] floats, or null when absent/too short. */
    public function normalize(mixed $route): ?array
    {
        if (! is_array($route) || count($route) < 2) {
            return null;
        }

        $points = [];
        foreach ($route as $point) {
            if (! is_array($point) || count($point) < 2) {
                return null;
            }
            $points[] = [(float) $point[0], (float) $point[1]];
        }

        return $points;
    }

    /** Haversine length of a [[lat, lng], …] polyline, in kilometres. */
    public function routeLengthKm(array $points): float
    {
        $radius = 6371.0088;
        $total = 0.0;
        $count = count($points);

        for ($i = 1; $i < $count; $i++) {
            [$lat1, $lon1] = [(float) $points[$i - 1][0], (float) $points[$i - 1][1]];
            [$lat2, $lon2] = [(float) $points[$i][0], (float) $points[$i][1]];

            $phi1 = deg2rad($lat1);
            $phi2 = deg2rad($lat2);
            $dPhi = $phi2 - $phi1;
            $dLambda = deg2rad($lon2 - $lon1);

            $a = sin($dPhi / 2) ** 2 + cos($phi1) * cos($phi2) * sin($dLambda / 2) ** 2;
            $total += 2 * $radius * asin(min(1.0, sqrt($a)));
        }

        return round(max(0.1, $total), 3);
    }
}
