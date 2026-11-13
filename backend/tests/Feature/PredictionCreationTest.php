<?php

namespace Tests\Feature;

use App\Models\Prediction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Feature coverage for the prediction flow, with the FastAPI service faked at
 * the HTTP boundary (no network, no Python process required).
 *
 * Regression tests for the contract bug fixed in PredictionService: the ML
 * service does not echo the request back, so saved predictions must persist
 * the *effective* distance/elevation (drawn route wins over typed distance) —
 * previously every saved plan stored distance_km = 0 and paceMinPerKm = null.
 */
class PredictionCreationTest extends TestCase
{
    use RefreshDatabase;

    /** Two points ≈ 1.55 km apart in Metro Manila. */
    private const ROUTE = [
        [14.676, 121.0437],
        [14.686, 121.0537],
    ];

    private const ROUTE_KM = 1.547;

    private function athlete(): User
    {
        return User::create([
            'name' => 'Test Athlete',
            'email' => 'athlete@trana.test',
            // 'hashed' cast hashes on write; no plaintext is stored.
            'password' => 'test-password-123',
        ]);
    }

    /** Fake a healthy FastAPI response and return the fixture for reference. */
    private function fakeMlPredict(): array
    {
        $payload = [
            'duration' => [
                'minutes' => 61.1,
                'hours' => 1.02,
                'range' => ['low' => 53.5, 'high' => 68.8],
                'pace_min_per_km' => 6.11,
                'speed_kmh' => 9.82,
                'confidence' => 0.87,
                'reference_speed_kmh' => 10.0,
                'basis' => 'gradient_boosted_pace_factor',
            ],
            'fueling' => [
                'intensity' => 'vigorous',
                'met' => 10.47,
                'calories' => ['total' => 640, 'per_hour' => 628, 'from_carbs_pct' => 60],
                'carbs' => ['per_hour_g' => 30, 'total_g' => 31, 'daily_target_g' => 480, 'pre_session_g' => 60],
                'sodium' => ['per_hour_mg' => 605, 'total_mg' => 615],
                'fluid' => ['per_hour_ml' => 715, 'total_ml' => 728],
                'timeline' => [
                    ['window' => '3 h before', 'label' => 'Pre-activity meal', 'detail' => '72 g carbs', 'carbs_g' => 72, 'icon' => 'meal'],
                ],
                'notes' => ['Target 30 g of carbohydrate per hour.'],
            ],
            'model' => [
                'name' => 'TRANA duration model',
                'version' => 'test-model-v1',
                'metrics' => ['r2' => 0.95, 'mae_min' => 9.5],
            ],
        ];

        Http::fake(['https://ml.test/predict' => Http::response($payload, 200)]);

        return $payload;
    }

    public function test_prediction_is_stored_with_the_typed_distance(): void
    {
        Sanctum::actingAs($this->athlete());
        $this->fakeMlPredict();

        $response = $this->postJson('/api/predictions', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'elevation_gain_m' => 80,
            'temperature_c' => 26,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.activity_type', 'run')
            ->assertJsonPath('data.fueling.carbs.perHourG', 30) // snake_case -> camelCase
            ->assertJsonPath('data.model.version', 'test-model-v1');

        $this->assertEqualsWithDelta(10.0, (float) $response->json('data.distance_km'), 0.0001);
        // 61.1 min / 10 km — must not be null even though the ML response
        // does not carry a distance back.
        $this->assertEqualsWithDelta(6.11, (float) $response->json('data.duration.paceMinPerKm'), 0.001);
        $this->assertSame(80, (int) $response->json('data.elevation_gain_m'));

        // The HTTP client sent a usable distance to the ML service.
        Http::assertSent(fn ($request) => str_contains($request->url(), '/predict')
            && abs((float) $request->data()['distance_km'] - 10.0) < 0.0001);

        $stored = Prediction::sole();
        $this->assertEqualsWithDelta(10.0, (float) $stored->distance_km, 0.0001);
        $this->assertSame(80, (int) $stored->elevation_gain_m);
        $this->assertSame('planned', $stored->status);
    }

    public function test_drawn_route_is_measured_and_wins_over_typed_distance(): void
    {
        Sanctum::actingAs($this->athlete());
        $this->fakeMlPredict();

        $response = $this->postJson('/api/predictions', [
            'activity_type' => 'run',
            'distance_km' => 50, // typed…
            'route' => self::ROUTE, // …but the drawn route wins (docs/api.md contract)
            'elevation_gain_m' => 40,
        ]);

        $response->assertCreated();

        Http::assertSent(fn ($request) => str_contains($request->url(), '/predict')
            && abs((float) $request->data()['distance_km'] - self::ROUTE_KM) < 0.01);

        $this->assertEqualsWithDelta(self::ROUTE_KM, (float) $response->json('data.distance_km'), 0.01);
        $this->assertEqualsWithDelta(self::ROUTE_KM, (float) Prediction::sole()->distance_km, 0.01);
    }

    public function test_route_only_submission_is_accepted(): void
    {
        Sanctum::actingAs($this->athlete());
        $this->fakeMlPredict();

        // distance_km intentionally omitted — StorePredictionRequest allows a
        // route to supply it. Previously this crashed with an undefined-key
        // ErrorException (HTTP 500) before the ML service was ever called.
        $response = $this->postJson('/api/predictions', [
            'activity_type' => 'ride',
            'route' => self::ROUTE,
            'elevation_gain_m' => 30,
        ]);

        $response->assertCreated();

        Http::assertSent(fn ($request) => str_contains($request->url(), '/predict')
            && abs((float) $request->data()['distance_km'] - self::ROUTE_KM) < 0.01);

        $this->assertEqualsWithDelta(self::ROUTE_KM, (float) Prediction::sole()->distance_km, 0.01);
        $this->assertEqualsWithDelta(self::ROUTE_KM, (float) $response->json('data.distance_km'), 0.01);
    }

    public function test_preview_also_accepts_a_route_without_distance(): void
    {
        Sanctum::actingAs($this->athlete());
        $this->fakeMlPredict();

        $response = $this->postJson('/api/predictions/preview', [
            'activity_type' => 'run',
            'route' => self::ROUTE,
        ]);

        // Previously: distance 0 sent upstream → ML 422 → Laravel 503.
        $response->assertOk();

        Http::assertSent(fn ($request) => str_contains($request->url(), '/predict')
            && abs((float) $request->data()['distance_km'] - self::ROUTE_KM) < 0.01);

        $this->assertDatabaseCount('predictions', 0); // preview persists nothing
    }

    public function test_missing_distance_and_route_fails_validation(): void
    {
        Sanctum::actingAs($this->athlete());
        Http::fake();

        $response = $this->postJson('/api/predictions', ['activity_type' => 'run']);

        $response->assertStatus(422);
        $this->assertArrayHasKey('distance_km', $response->json('errors'));
        Http::assertNothingSent(); // validation happens before the ML call
        $this->assertDatabaseCount('predictions', 0);
    }

    public function test_ml_outage_returns_503_and_persists_nothing(): void
    {
        Sanctum::actingAs($this->athlete());
        Http::fake(['https://ml.test/predict' => Http::response('upstream down', 500)]);

        $response = $this->postJson('/api/predictions', [
            'activity_type' => 'run',
            'distance_km' => 10,
        ]);

        $response->assertStatus(503);
        $this->assertStringContainsString('prediction service', (string) $response->json('message'));
        $this->assertDatabaseCount('predictions', 0);
    }

    public function test_guests_cannot_create_predictions(): void
    {
        Http::fake();

        $this->postJson('/api/predictions', [
            'activity_type' => 'run',
            'distance_km' => 10,
        ])->assertStatus(401);

        Http::assertNothingSent();
        $this->assertDatabaseCount('predictions', 0);
    }

    public function test_sweat_override_is_sent_to_ml_without_changing_the_profile(): void
    {
        $user = $this->athlete();
        $user->ensureProfile();
        Sanctum::actingAs($user);
        $this->fakeMlPredict();

        $this->postJson('/api/predictions', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'sweat_profile' => 'high',
        ])->assertCreated();

        Http::assertSent(fn ($request) => $request->data()['sweat_profile'] === 'high');
        $this->assertSame('normal', $user->fitnessProfile->fresh()->sweat_profile);
    }

    public function test_invalid_drawn_route_is_rejected_before_calling_ml(): void
    {
        Sanctum::actingAs($this->athlete());
        Http::fake();
        foreach ([
            [[14.676, 121.0437]],
            [[14.676, 121.0437], [14.676, 121.0437]],
            [[0, 0], [20, 20]],
        ] as $route) {
            $this->postJson('/api/predictions', [
                'activity_type' => 'run',
                'distance_km' => 5,
                'route' => $route,
            ])->assertUnprocessable()->assertJsonValidationErrors('route');
        }

        Http::assertNothingSent();
        $this->assertDatabaseCount('predictions', 0);
    }

    public function test_planned_for_accepts_current_minute_timestamp_and_rejects_old_past_dates(): void
    {
        Sanctum::actingAs($this->athlete());
        $this->fakeMlPredict();

        $this->postJson('/api/predictions', [
            'activity_type' => 'run',
            'distance_km' => 5,
            'planned_for' => now()->subMinutes(5)->toIso8601String(),
        ])->assertCreated();

        $this->postJson('/api/predictions', [
            'activity_type' => 'run',
            'distance_km' => 5,
            'planned_for' => now()->subDays(2)->toIso8601String(),
        ])->assertUnprocessable()->assertJsonValidationErrors('planned_for');
    }

    public function test_calibration_factor_and_carb_goal_are_sent_on_predict_and_preview(): void
    {
        $user = $this->athlete();
        $user->ensureProfile()->update(['weight_kg' => 72]);
        $user->ensureGoals()->update(['carb_target_g' => 450]);
        Sanctum::actingAs($user);

        foreach (['2026-11-06', '2026-11-07', '2026-11-08'] as $day) {
            $this->postJson('/api/energy-expenditure', [
                'device_type' => 'garmin',
                'activity_type' => 'run',
                'distance_km' => 10,
                'duration_min' => 60,
                'weight_kg' => 72,
                'measured_calories' => 890,
                'recorded_at' => "{$day}T06:30:00+08:00",
            ])->assertCreated();
        }

        $this->fakeMlPredict();

        $this->postJson('/api/predictions/preview', [
            'activity_type' => 'run',
            'distance_km' => 10,
        ])->assertOk();

        Http::assertSent(fn ($request) => str_contains($request->url(), '/predict')
            && abs((float) ($request->data()['energy_calibration_factor'] ?? 0) - (890 / 742)) < 0.01
            && (int) ($request->data()['daily_carb_target_g'] ?? 0) === 450);

        $this->postJson('/api/predictions', [
            'activity_type' => 'run',
            'distance_km' => 10,
        ])->assertCreated();

        Http::assertSent(fn ($request) => str_contains($request->url(), '/predict')
            && abs((float) ($request->data()['energy_calibration_factor'] ?? 0) - (890 / 742)) < 0.01
            && (int) ($request->data()['daily_carb_target_g'] ?? 0) === 450);
    }
}
