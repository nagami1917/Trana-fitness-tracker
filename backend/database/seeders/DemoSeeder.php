<?php

namespace Database\Seeders;

use App\Models\Activity;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;

/**
 * Creates the public demo athlete with ~8 weeks of realistic history so TRANA
 * has something to learn from the moment it boots.
 */
class DemoSeeder extends Seeder
{
    /** [days ago, type, distance km] */
    private const PLAN = [
        [0, 'run', 5.0], [0, 'walk', 1.6], [1, 'run', 8.2], [2, 'ride', 12.0],
        [3, 'walk', 3.2], [4, 'run', 4.6], [5, 'hike', 7.4], [6, 'run', 10.1],
        [8, 'ride', 24.5], [9, 'run', 6.3], [10, 'run', 5.1], [12, 'walk', 4.0],
        [13, 'run', 7.8], [15, 'hike', 11.2], [16, 'run', 4.2], [18, 'ride', 18.0],
        [19, 'run', 9.4], [21, 'run', 5.6], [23, 'walk', 2.8], [25, 'run', 12.4],
        [28, 'ride', 30.6], [30, 'run', 6.0], [33, 'run', 5.3], [36, 'hike', 8.8],
        [38, 'run', 8.6], [42, 'ride', 22.1], [45, 'run', 4.8], [49, 'run', 7.2],
        [53, 'walk', 3.5], [57, 'run', 9.0], [61, 'ride', 26.4], [66, 'run', 5.9],
    ];

    private const SPEED = ['run' => 10.3, 'ride' => 21.5, 'walk' => 4.9, 'hike' => 3.7];

    public function run(): void
    {
        $user = User::firstOrCreate(
            ['email' => env('DEMO_EMAIL', 'demo@trana.app')],
            ['name' => 'Nagami', 'password' => Hash::make(env('DEMO_PASSWORD', 'trana-demo'))]
        );

        $user->ensureProfile();
        $user->ensureGoals();

        if ($user->activities()->count() === 0) {
            self::seedActivitiesFor($user);
        }
    }

    public static function seedActivitiesFor(User $user, bool $resetProfile = false): void
    {
        $profile = $user->ensureProfile();
        $weight = (float) $profile->weight_kg;

        if ($resetProfile) {
            $profile->update(['weight_kg' => 55, 'height_cm' => 162, 'birth_year' => 1999, 'sex' => 'female', 'experience_level' => 4, 'city' => 'Quezon City, PH']);
            $weight = 55.0;
        }

        mt_srand(20261103);
        $base = ['lat' => 14.676, 'lng' => 121.0437];

        foreach (self::PLAN as $index => [$daysAgo, $type, $distance]) {
            $startedAt = Carbon::now()
                ->subDays($daysAgo)
                ->setTime($type === 'walk' ? 19 : 6 + ($index % 3), ($index * 7) % 60, 0);

            $elevationPerKm = match ($type) {
                'hike' => 40 + mt_rand(0, 45),
                'ride' => 6 + mt_rand(0, 10),
                default => 4 + mt_rand(0, 9),
            };
            $elevation = (int) round($distance * $elevationPerKm);

            $speed = self::SPEED[$type] * (0.94 + (mt_rand(0, 120) / 1000)) * (1 - min(0.18, $elevationPerKm * 0.0012));
            $minutes = round($distance / $speed * 60, 1);
            $met = self::estimateMet($type, $speed, (float) $elevationPerKm);
            $calories = (int) round($met * $weight * ($minutes / 60));

            $user->activities()->create([
                'activity_type' => $type,
                'distance_km' => $distance,
                'elevation_gain_m' => $elevation,
                'duration_min' => $minutes,
                'calories' => $calories,
                'avg_heart_rate' => (int) round(112 + $met * 4 + mt_rand(0, 9)),
                'started_at' => $startedAt,
                'route' => self::syntheticRoute($base, $distance, $index),
                'source' => 'seed',
            ]);
        }

        $profile->update(['experience_level' => 4]);
    }

    /** A wandering loop scaled so its great-circle length matches the distance. */
    private static function syntheticRoute(array $center, float $distanceKm, int $seed): array
    {
        mt_srand(1000 + $seed);
        $points = [];
        $lat = $center['lat'];
        $lng = $center['lng'];
        $angle = 0.0;

        for ($i = 0; $i < 26; $i++) {
            $angle += (mt_rand(0, 1000) / 1000 - 0.5) * 0.9;
            $lat += sin($angle) * 0.0016;
            $lng += cos($angle) * 0.0016;
            $points[] = [$lat, $lng];
        }

        $length = 0.0;
        for ($i = 1; $i < count($points); $i++) {
            $length += self::distanceBetween($points[$i - 1], $points[$i]);
        }
        $factor = $length > 0 ? $distanceKm / $length : 1;

        $midLat = array_sum(array_column($points, 0)) / count($points);
        $midLng = array_sum(array_column($points, 1)) / count($points);

        return array_map(fn ($p) => [
            round($midLat + ($p[0] - $midLat) * $factor, 5),
            round($midLng + ($p[1] - $midLng) * $factor, 5),
        ], $points);
    }

    private static function distanceBetween(array $a, array $b): float
    {
        $r = 6371.0088;
        $phi1 = deg2rad($a[0]);
        $phi2 = deg2rad($b[0]);
        $dPhi = $phi2 - $phi1;
        $dLambda = deg2rad($b[1] - $a[1]);
        $h = sin($dPhi / 2) ** 2 + cos($phi1) * cos($phi2) * sin($dLambda / 2) ** 2;

        return 2 * $r * asin(min(1.0, sqrt($h)));
    }

    private static function estimateMet(string $type, float $speed, float $elevationPerKm): float
    {
        $climb = min(2.6, max(0.0, $elevationPerKm) * 0.045);
        $met = match ($type) {
            'run' => $speed * 1.03,
            'ride' => 3.2 + $speed * 0.29,
            'walk' => 2.0 + $speed * 0.45,
            default => 3.6 + $speed * 0.60,
        };

        return max(1.6, $met + $climb);
    }
}
