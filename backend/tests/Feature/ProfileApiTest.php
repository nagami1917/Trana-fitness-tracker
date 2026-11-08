<?php

namespace Tests\Feature;

use App\Models\Prediction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Step 4 — user fitness profile.
 *
 * Covers the spec's operations (create, view, edit, update weight, update
 * fitness level) and proves the stored values reach the prediction service.
 */
class ProfileApiTest extends TestCase
{
    use RefreshDatabase;

    private function athlete(string $email = 'profile@trana.test'): User
    {
        return User::create([
            'name' => 'Profile Athlete',
            'email' => $email,
            'password' => 'test-password-123',
        ]);
    }

    private function fakeMl(): void
    {
        Http::fake(['https://ml.test/predict' => Http::response([
            'duration' => [
                'minutes' => 60.0,
                'range' => ['low' => 52.0, 'high' => 68.0],
                'speed_kmh' => 10.0,
                'confidence' => 0.82,
                'reference_speed_kmh' => 10.0,
                'basis' => 'gradient_boosted_pace_factor',
            ],
            'fueling' => ['carbs' => ['per_hour_g' => 30], 'sodium' => ['per_hour_mg' => 550], 'fluid' => ['per_hour_ml' => 650]],
            'model' => ['name' => 'TRANA duration model', 'version' => 'test-v1', 'metrics' => []],
        ], 200)]);
    }

    public function test_profile_endpoints_require_authentication(): void
    {
        $this->getJson('/api/profile')->assertUnauthorized();
        $this->postJson('/api/profile', ['weight_kg' => 70])->assertUnauthorized();
        $this->patchJson('/api/profile/weight', ['weight_kg' => 70])->assertUnauthorized();
        $this->patchJson('/api/profile/fitness-level', ['fitness_level' => 3])->assertUnauthorized();
    }

    public function test_profile_can_be_created_with_the_spec_fields(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);
        $year = (int) date('Y');

        $response = $this->postJson('/api/profile', [
            'weight_kg' => 70.5,
            'height_cm' => 175,
            'sex' => 'male',
            'birth_year' => $year - 30,
            'fitness_level' => 4,
            'activity_experience' => 6.5,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.weight_kg', 70.5)
            ->assertJsonPath('data.height_cm', 175)
            ->assertJsonPath('data.sex', 'male')
            ->assertJsonPath('data.age', 30)
            ->assertJsonPath('data.fitness_level', 4)
            ->assertJsonPath('data.experience_level', 4)
            ->assertJsonPath('data.activity_experience', 6.5)
            ->assertJsonPath('data.fitness_level_source', 'user');

        $this->assertDatabaseHas('fitness_profiles', [
            'user_id' => $user->id,
            'birth_year' => $year - 30,
            'experience_level' => 4,
            'activity_experience' => 6.5,
        ]);

        // The spec's read-only projection exposes the same row.
        $this->assertDatabaseHas('fitness_profiles', ['user_id' => $user->id]);
        $this->assertSame(1, (int) DB::table('user_profiles')->where('user_id', $user->id)->value('fitness_level'));
    }

    public function test_creating_a_second_profile_is_a_conflict(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->postJson('/api/profile', ['weight_kg' => 70])->assertCreated();
        $this->postJson('/api/profile', ['weight_kg' => 80])
            ->assertStatus(409)
            ->assertJsonPath('data.weight_kg', 70);
    }

    public function test_profile_can_be_viewed(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->getJson('/api/profile')
            ->assertOk()
            ->assertJsonPath('data.fitness_level', 1)
            ->assertJsonPath('data.activity_experience', null);
    }

    public function test_profile_can_be_edited_with_spec_field_aliases(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);
        $year = (int) date('Y');

        $this->patchJson('/api/profile', [
            'age' => 32,
            'fitness_level' => 5,
            'activity_experience' => 11.5,
            'height_cm' => 168,
        ])->assertOk()
            ->assertJsonPath('data.age', 32)
            ->assertJsonPath('data.birth_year', $year - 32)
            ->assertJsonPath('data.fitness_level', 5)
            ->assertJsonPath('data.activity_experience', 11.5);

        $this->putJson('/api/profile', ['weight_kg' => 64])
            ->assertOk()
            ->assertJsonPath('data.weight_kg', 64);
    }

    public function test_weight_can_be_updated_on_its_own(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        $this->patchJson('/api/profile/weight', ['weight_kg' => 72.5])
            ->assertOk()
            ->assertJsonPath('data.weight_kg', 72.5);

        $this->assertDatabaseHas('fitness_profiles', ['user_id' => $user->id, 'weight_kg' => 72.5]);

        $this->patchJson('/api/profile/weight', ['weight_kg' => 10])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('weight_kg');

        $this->patchJson('/api/profile/weight', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('weight_kg');
    }

    public function test_fitness_level_can_be_updated_on_its_own(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);

        $this->patchJson('/api/profile/fitness-level', ['fitness_level' => 4])
            ->assertOk()
            ->assertJsonPath('data.fitness_level', 4)
            ->assertJsonPath('data.fitness_level_source', 'user');

        $this->assertDatabaseHas('fitness_profiles', ['user_id' => $user->id, 'experience_level' => 4]);

        $this->patchJson('/api/profile/fitness-level', ['fitness_level' => 9])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('fitness_level');

        $this->patchJson('/api/profile/fitness-level', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('fitness_level');
    }

    public function test_a_chosen_fitness_level_is_not_overwritten_by_logging_activity(): void
    {
        Sanctum::actingAs($this->athlete());

        $this->postJson('/api/profile', ['weight_kg' => 68, 'fitness_level' => 5])->assertCreated();

        $this->postJson('/api/activities', [
            'activity_type' => 'run',
            'distance_km' => 5,
            'duration_min' => 30,
            'started_at' => now()->subDay()->toIso8601String(),
        ])->assertCreated();

        $this->getJson('/api/profile')
            ->assertOk()
            ->assertJsonPath('data.fitness_level', 5)
            ->assertJsonPath('data.fitness_level_source', 'user');
    }

    public function test_fitness_level_can_be_handed_back_to_the_activity_heuristic(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);
        $this->postJson('/api/profile', ['weight_kg' => 68, 'fitness_level' => 5])->assertCreated();

        // 12 logged sessions put the heuristic at level 3.
        foreach (range(1, 12) as $day) {
            $user->activities()->create([
                'activity_type' => 'run',
                'distance_km' => 5,
                'duration_min' => 30,
                'started_at' => now()->subDays($day),
            ]);
        }

        $this->patchJson('/api/profile/fitness-level', ['source' => 'auto'])
            ->assertOk()
            ->assertJsonPath('data.fitness_level', 3)
            ->assertJsonPath('data.fitness_level_source', 'auto');
    }

    public function test_prediction_receives_the_profile_values(): void
    {
        $user = $this->athlete();
        Sanctum::actingAs($user);
        $this->fakeMl();

        $year = (int) date('Y');
        $this->postJson('/api/profile', [
            'weight_kg' => 77,
            'height_cm' => 180,
            'sex' => 'male',
            'birth_year' => $year - 40,
            'fitness_level' => 4,
            'activity_experience' => 9,
        ])->assertCreated();

        $this->postJson('/api/predictions', [
            'activity_type' => 'run',
            'distance_km' => 10,
            'elevation_gain_m' => 50,
        ])->assertCreated()
            ->assertJsonPath('data.profile.fitness_level', 4)
            ->assertJsonPath('data.profile.weight_kg', 77);

        Http::assertSent(fn ($request) => str_contains($request->url(), '/predict')
            && (float) $request->data()['weight_kg'] === 77.0
            && (int) $request->data()['experience_level'] === 4
            && (int) $request->data()['fitness_level'] === 4
            && (int) $request->data()['age'] === 40
            && $request->data()['sex'] === 'male'
            && (float) $request->data()['height_cm'] === 180.0
            && (float) $request->data()['activity_experience'] === 9.0);

        $stored = Prediction::sole();
        $this->assertSame(4, $stored->payload['profile']['fitness_level']);
        $this->assertEqualsWithDelta(77.0, $stored->payload['profile']['weight_kg'], 0.001);
        $this->assertEqualsWithDelta(9.0, $stored->payload['profile']['activity_experience'], 0.001);
    }

    public function test_preview_also_sends_the_profile_values(): void
    {
        Sanctum::actingAs($this->athlete());
        $this->fakeMl();

        $this->postJson('/api/profile', ['weight_kg' => 61, 'fitness_level' => 2])->assertCreated();

        $this->postJson('/api/predictions/preview', [
            'activity_type' => 'run',
            'distance_km' => 5,
        ])->assertOk();

        Http::assertSent(fn ($request) => str_contains($request->url(), '/predict')
            && (int) $request->data()['fitness_level'] === 2
            && (float) $request->data()['weight_kg'] === 61.0);
    }
}
