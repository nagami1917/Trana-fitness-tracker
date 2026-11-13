<?php

namespace App\Console\Commands;

use App\Http\Controllers\Api\NotificationController;
use App\Models\User;
use Illuminate\Console\Command;

class DispatchFuelingReminders extends Command
{
    protected $signature = 'trana:send-fueling-reminders';

    protected $description = 'Synthesize pre-workout fueling, gear wear, and race carb-loading reminders for subscribed athletes.';

    public function handle(): int
    {
        $count = 0;
        User::whereHas('pushSubscriptions')->chunkById(100, function ($users) use (&$count) {
            foreach ($users as $user) {
                NotificationController::synthesizeForUser($user);
                $user->pushSubscriptions()->update(['last_used_at' => now()]);
                $count++;
            }
        });

        $this->info("Synthesized fueling reminders for {$count} athlete(s).");

        return self::SUCCESS;
    }
}
