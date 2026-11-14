<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WeightLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\AuthTestHelpers;
use Tests\TestCase;

class WeightLogTest extends TestCase
{
    use RefreshDatabase;
    use AuthTestHelpers;

    private function registerAthlete(string $email = 'weight@gmail.com'): array
    {
        $response = $this->createVerifiedAccount('Weight Athlete', $email);
        app('auth')->forgetGuards();

        return ['Authorization' => 'Bearer '.$response['token']];
    }

    public function test_logging_weight_upserts_the_day_and_syncs_the_profile(): void
    {
        $headers = $this->registerAthlete();

        $this->postJson('/api/weight-logs', ['weight_kg' => 70.5], $headers)
            ->assertCreated()
            ->assertJsonPath('data.weight_kg', 70.5);

        // Same day again → replaces, never duplicates.
        $this->postJson('/api/weight-logs', ['weight_kg' => 70.1], $headers)->assertCreated();
        $this->assertSame(1, WeightLog::count());

        $this->assertEqualsWithDelta(70.1, (float) \App\Models\FitnessProfile::first()->weight_kg, 0.001);

        $list = $this->getJson('/api/weight-logs', $headers)->assertOk();
        $list->assertJsonCount(1, 'data')->assertJsonPath('data.0.weight_kg', 70.1);
    }

    public function test_older_weigh_in_does_not_override_a_newer_profile_weight(): void
    {
        $headers = $this->registerAthlete();

        $this->postJson('/api/weight-logs', ['weight_kg' => 69], $headers)->assertCreated();
        $this->postJson('/api/weight-logs', [
            'weight_kg' => 71,
            'measured_at' => now()->subDays(3)->toDateString(),
        ], $headers)->assertCreated();

        // Profile mirrors the NEWEST date, not the row just written.
        $this->assertSame(2, WeightLog::count());
        $this->assertSame(69.0, (float) \App\Models\FitnessProfile::first()->weight_kg);

        // Newest first in the feed.
        $rows = $this->getJson('/api/weight-logs', $headers)->assertOk()->json('data');
        $this->assertSame(69.0, (float) $rows[0]['weight_kg']);
    }

    public function test_profile_weight_patch_also_writes_the_timeline(): void
    {
        $headers = $this->registerAthlete();

        $this->patchJson('/api/profile/weight', ['weight_kg' => 66.6], $headers)->assertOk();

        $this->assertSame(1, WeightLog::count());
        $this->assertSame(66.6, (float) WeightLog::first()->weight_kg);
    }

    public function test_future_weigh_ins_are_rejected(): void
    {
        $headers = $this->registerAthlete();

        $this->postJson('/api/weight-logs', [
            'weight_kg' => 70,
            'measured_at' => now()->addDay()->toDateString(),
        ], $headers)->assertStatus(422);
    }

    public function test_athletes_cannot_delete_each_others_weigh_ins(): void
    {
        $headersA = $this->registerAthlete('a-weight@gmail.com');
        $this->postJson('/api/weight-logs', ['weight_kg' => 70], $headersA)->assertCreated();
        $log = WeightLog::firstOrFail();

        $headersB = $this->registerAthlete('b-weight@gmail.com');
        app('auth')->forgetGuards();

        $this->deleteJson('/api/weight-logs/'.$log->id, [], $headersB)->assertNotFound();
        $this->assertNotNull($log->fresh(), 'Another athlete must not delete the row');

        // Guards cache the resolved user across in-process requests — B's
        // request above would otherwise leak into A's and 404 the owner.
        app('auth')->forgetGuards();

        $this->deleteJson('/api/weight-logs/'.$log->id, [], $headersA)->assertOk();
        $this->assertNull($log->fresh());
    }
}
