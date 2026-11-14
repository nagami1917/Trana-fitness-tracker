<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\GoalEvent;
use App\Models\InAppNotification;
use App\Models\Prediction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\GoogleAuthTestHelpers;
use Tests\TestCase;

class NotificationCenterTest extends TestCase
{
    use RefreshDatabase;
    use GoogleAuthTestHelpers;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepareGoogleAuth();
    }

    private function registerAthlete(string $email = 'notify@gmail.com'): array
    {
        $response = $this->createGoogleAccount('Notify Athlete', $email);

        return ['Authorization' => 'Bearer '.$response['token']];
    }

    private function makePlan(User $user): Prediction
    {
        return Prediction::create([
            'user_id' => $user->id,
            'activity_type' => 'run',
            'distance_km' => 5,
            'planned_for' => now()->setTime(7, 30),
            'status' => 'planned',
            'duration_min' => 30,
            'duration_low_min' => 27,
            'duration_high_min' => 34,
        ]);
    }

    public function test_feed_starts_empty_and_synthesizes_reminders_once(): void
    {
        $headers = $this->registerAthlete();
        $user = User::firstOrFail();

        // Empty until there is something to remind about.
        $this->getJson('/api/notifications', $headers)
            ->assertOk()
            ->assertJsonPath('meta.unread', 0)
            ->assertJsonCount(0, 'data');

        $this->makePlan($user);
        $activity = Activity::create([
            'user_id' => $user->id,
            'activity_type' => 'run',
            'distance_km' => 8,
            'duration_min' => 45,
            'started_at' => now()->subHour(),
        ]);
        GoalEvent::create([
            'user_id' => $user->id,
            'activity_id' => $activity->id,
            'date' => today(),
            'goal_key' => 'daily_calories',
            'target' => 2700,
            'achieved_value' => 2810,
        ]);

        $first = $this->getJson('/api/notifications', $headers)->assertOk();
        $first->assertJsonCount(2, 'data')->assertJsonPath('meta.unread', 2);

        // Fetching again must not duplicate reminders (dedupe keys).
        $this->getJson('/api/notifications', $headers)
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.unread', 2);

        $this->assertSame(2, InAppNotification::where('user_id', $user->id)->count());
    }

    public function test_mark_all_read_clears_the_badge(): void
    {
        $headers = $this->registerAthlete();
        $user = User::firstOrFail();
        $this->makePlan($user);

        $this->getJson('/api/notifications', $headers)->assertJsonPath('meta.unread', 1);

        $this->postJson('/api/notifications/read-all', [], $headers)->assertOk();

        $this->getJson('/api/notifications', $headers)
            ->assertOk()
            ->assertJsonPath('meta.unread', 0);
        $this->assertNotNull(InAppNotification::where('user_id', $user->id)->first()->read_at);
    }

    public function test_athletes_cannot_touch_each_others_notifications(): void
    {
        $headersA = $this->registerAthlete('a@gmail.com');
        $userA = User::where('email', 'a@gmail.com')->firstOrFail();
        $this->makePlan($userA);
        $this->getJson('/api/notifications', $headersA);

        $notification = InAppNotification::where('user_id', $userA->id)->firstOrFail();

        $headersB = $this->registerAthlete('b@gmail.com');
        // Guards are reused across requests inside one test process — drop
        // athlete A's resolution before athlete B authenticates.
        app('auth')->forgetGuards();
        $this->postJson('/api/notifications/'.$notification->id.'/read', [], $headersB)
            ->assertNotFound();

        $this->assertNull($notification->fresh()->read_at, 'Another athlete must not mark it read');
    }
}
