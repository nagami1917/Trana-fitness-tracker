<?php

namespace Tests\Feature;

use App\Models\Activity;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\AuthTestHelpers;
use Tests\TestCase;

/**
 * Structured intake on a session.
 *
 * Track knows what the athlete actually consumed (fluid and carbs logged during
 * the session) but only ever wrote it into the free-text `notes` column. The
 * next plan needs the numbers to compare its own suggestion against reality, so
 * these tests pin the API contract:
 *
 *   - the figures persist as numbers;
 *   - they come back in both the activity resource and the ML history feed;
 *   - "not logged" stays null rather than becoming a misleading zero;
 *   - implausible values are refused.
 */
class ActivityIntakeTest extends TestCase
{
    use RefreshDatabase;
    use AuthTestHelpers;

    private function bearer(string $token): array
    {
        app('auth')->forgetGuards();

        return ['Authorization' => 'Bearer '.$token];
    }

    private function createActivity(string $token, array $overrides = [])
    {
        return $this->postJson('/api/activities', array_merge([
            'activity_type' => 'ride',
            'distance_km' => 40,
            'duration_min' => 120,
            'elevation_gain_m' => 150,
            'started_at' => now()->subHours(5)->toIso8601String(),
        ], $overrides), $this->bearer($token));
    }

    public function test_intake_is_stored_as_numbers_and_returned(): void
    {
        $token = $this->createVerifiedAccount('Athlete', 'intake@gmail.com')['token'];

        $response = $this->createActivity($token, [
            'fluid_ml' => 900,
            'carbs_g' => 100,
            'sodium_mg' => 600,
            'notes' => 'Intake during session: 900 ml fluid, 100 g carbs',
        ])->assertCreated();

        $response->assertJsonPath('data.fluid_ml', 900)
            ->assertJsonPath('data.carbs_g', 100)
            ->assertJsonPath('data.sodium_mg', 600);

        $activity = Activity::first();
        $this->assertSame(900, $activity->fluid_ml);
        $this->assertSame(100, $activity->carbs_g);
    }

    public function test_unlogged_intake_stays_null_and_is_not_zero(): void
    {
        $token = $this->createVerifiedAccount('Athlete', 'nointake@gmail.com')['token'];

        $response = $this->createActivity($token)->assertCreated();

        // Null means "not recorded". Zero would tell the fueling comparison the
        // athlete fuelled with nothing, which is a different claim entirely.
        $this->assertNull($response->json('data.fluid_ml'));
        $this->assertNull($response->json('data.carbs_g'));
        $this->assertNull(Activity::first()->carbs_g);
    }

    public function test_history_feed_carries_intake_for_the_model(): void
    {
        $token = $this->createVerifiedAccount('Athlete', 'history@gmail.com')['token'];

        $this->createActivity($token, ['carbs_g' => 100, 'fluid_ml' => 900])->assertCreated();

        // ActivityService::history() is what the ML service receives as history.
        $service = app(\App\Services\ActivityService::class);
        $rows = $service->history(\App\Models\User::firstWhere('email', 'history@gmail.com'));

        $this->assertCount(1, $rows);
        $this->assertSame(100, $rows[0]['carbs_g']);
        $this->assertSame(900, $rows[0]['fluid_ml']);
    }

    public function test_implausible_intake_is_rejected(): void
    {
        $token = $this->createVerifiedAccount('Athlete', 'typo@gmail.com')['token'];

        // A typo of 20000 ml would poison every future comparison.
        $this->createActivity($token, ['fluid_ml' => 20000])
            ->assertStatus(422)
            ->assertJsonValidationErrors('fluid_ml');

        $this->createActivity($token, ['carbs_g' => 9999])
            ->assertStatus(422)
            ->assertJsonValidationErrors('carbs_g');
    }

    public function test_a_mistyped_intake_figure_can_be_corrected(): void
    {
        $token = $this->createVerifiedAccount('Athlete', 'fix@gmail.com')['token'];

        // Fat-fingered the grams: 300 logged for a 2-hour ride meant 90.
        $created = $this->createActivity($token, ['carbs_g' => 300])->assertCreated();

        $this->patchJson('/api/activities/'.$created->json('data.id'), [
            'carbs_g' => 90,
        ], $this->bearer($token))
            ->assertOk()
            ->assertJsonPath('data.carbs_g', 90);

        $this->assertSame(90, Activity::first()->carbs_g);
    }

    public function test_baseline_rows_do_not_carry_intake(): void
    {
        $token = $this->createVerifiedAccount('Athlete', 'baseline@gmail.com')['token'];

        $this->postJson('/api/baseline-activities', [
            'activity_type' => 'ride',
            'distance_km' => 40,
            'duration_min' => 120,
            'elevation_gain_m' => 0,
            'performed_period' => 'last_week',
        ], $this->bearer($token))->assertCreated();

        // A remembered past session has no intake logged; the columns must stay
        // null rather than inherit a default.
        $this->assertNull(Activity::first()->carbs_g);
    }
}
