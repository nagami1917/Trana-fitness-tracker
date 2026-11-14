<?php

namespace Tests\Support;

use App\Notifications\EmailOtpNotification;
use Illuminate\Support\Facades\Notification;
use RuntimeException;

trait EmailOtpTestHelpers
{
    protected function sentOtpCodeFor(string $email): string
    {
        $code = null;
        Notification::assertSentOnDemand(
            EmailOtpNotification::class,
            function (EmailOtpNotification $notification, array $channels, $notifiable) use ($email, &$code): bool {
                if ($notifiable->routeNotificationFor('mail') !== strtolower($email)) {
                    return false;
                }

                $code = $notification->code;

                return true;
            },
        );

        if (! is_string($code)) {
            throw new RuntimeException('No email OTP was captured for the test address.');
        }

        return $code;
    }
}
