<?php

namespace Tests\Unit;

use App\Services\FuelingPredictionService;
use Tests\TestCase;

/**
 * The Laravel normaliser is a whitelist: it rebuilds the fueling block
 * field-by-field, so anything it does not explicitly copy is silently dropped
 * before the client ever sees it.
 *
 * That makes it the riskiest layer for the burn/intake split. The ML service can
 * emit `calories.carbs_burned_g` and `recovery` perfectly well, and the API will
 * still show nothing if this class does not carry them through. It fails
 * silently, too - a missing key is indistinguishable from an older model.
 */
class FuelingPredictionNormaliseTest extends TestCase
{
    private function service(): FuelingPredictionService
    {
        return new FuelingPredictionService();
    }

    /** A realistic ML payload for a 52 km / 2 h 43 m ride at 60 kg. */
    private function payload(): array
    {
        return [
            'fueling' => [
                'intensity' => 'vigorous',
                'met' => 9.6,
                'calories' => [
                    'total' => 1560,
                    'per_hour' => 576,
                    'from_carbs_pct' => 60,
                    'carbs_burned_g' => 234,
                ],
                'carbs' => [
                    'per_hour_g' => 85,
                    'total_g' => 230,
                    'daily_target_g' => 480,
                    'pre_session_g' => 60,
                ],
                'recovery' => [
                    'carbs_g' => 24,
                    'protein_g' => 15,
                    'window' => 'Within 30 min after',
                    'elevated_load' => false,
                    'note' => "Recovery covers the next session, not this one's energy cost.",
                ],
                'sodium' => ['per_hour_mg' => 678, 'total_mg' => 1837],
                'fluid' => ['per_hour_ml' => 715, 'total_ml' => 1936],
                'timeline' => [
                    [
                        'window' => 'Within 30 min after',
                        'label' => 'Recovery',
                        'detail' => '24 g carbs + 15 g protein',
                        'carbs_g' => 24,
                        'icon' => 'recovery',
                    ],
                ],
                'kit' => [],
                'notes' => [],
            ],
        ];
    }

    public function test_carries_burned_carbs_through_to_the_client(): void
    {
        $out = $this->service()->normalise($this->payload());

        $this->assertSame(234, $out['calories']['carbsBurnedG']);
        $this->assertSame(1560, $out['calories']['total']);
        $this->assertSame(60, $out['calories']['fromCarbsPct']);
    }

    public function test_carries_recovery_as_its_own_block(): void
    {
        $out = $this->service()->normalise($this->payload());

        $this->assertArrayHasKey('recovery', $out);
        $this->assertSame(24, $out['recovery']['carbsG']);
        $this->assertSame(15, $out['recovery']['proteinG']);
        $this->assertSame('Within 30 min after', $out['recovery']['window']);
        $this->assertFalse($out['recovery']['elevatedLoad']);
        $this->assertNotSame('', $out['recovery']['note']);
    }

    public function test_burn_stays_distinguishable_from_intake_after_normalising(): void
    {
        $out = $this->service()->normalise($this->payload());

        // The session oxidises more carbohydrate than the plan tells them to eat.
        $this->assertGreaterThan($out['carbs']['totalG'], $out['calories']['carbsBurnedG']);

        // Recovery is a fraction of the burn, not a refund of it.
        $recoveryKcal = $out['recovery']['carbsG'] * 4 + $out['recovery']['proteinG'] * 4;
        $this->assertLessThan($out['calories']['total'] / 2, $recoveryKcal);
    }

    public function test_recovery_survives_a_payload_without_it(): void
    {
        // An older ML process returns no `recovery`. The block must still exist
        // with safe zeroes, so the client can branch on the values rather than
        // on a missing key.
        $payload = $this->payload();
        unset($payload['fueling']['recovery']);

        $out = $this->service()->normalise($payload);

        $this->assertSame(0, $out['recovery']['carbsG']);
        $this->assertSame(0, $out['recovery']['proteinG']);
        $this->assertFalse($out['recovery']['elevatedLoad']);
    }

    public function test_elevated_load_flag_is_cast_to_bool(): void
    {
        $payload = $this->payload();
        $payload['fueling']['recovery']['elevated_load'] = 1;
        $payload['fueling']['recovery']['carbs_g'] = 29;

        $out = $this->service()->normalise($payload);

        $this->assertTrue($out['recovery']['elevatedLoad']);
        $this->assertSame(29, $out['recovery']['carbsG']);
    }
}
