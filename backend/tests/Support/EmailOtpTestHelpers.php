<?php

namespace Tests\Support;

use App\Notifications\EmailOtpNotification;
use Illuminate\Support\Facades\Notification;
use RuntimeException;

trait EmailOtpTestHelpers
{
    protected function registrationOtpCode(string $name, string $email, array $headers = []): string
    {
        Notification::fake();
        $this->postJson('/api/auth/register', ['name' => $name, 'email' => $email], $headers)
            ->assertAccepted();

        return $this->sentOtpCodeFor($email);
    }

    protected function registerWithOtp(string $name, string $email, array $headers = []): array
    {
        $code = $this->registrationOtpCode($name, $email, $headers);

        return $this->postJson('/api/auth/otp/verify', [
            'email' => $email,
            'code' => $code,
        ], $headers)->assertOk()->json();
    }

    protected function loginWithOtp(string $email, array $headers = []): array
    {
        Notification::fake();
        $this->postJson('/api/auth/login', ['email' => $email], $headers)->assertAccepted();
        $code = $this->sentOtpCodeFor($email);

        return $this->postJson('/api/auth/otp/verify', [
            'email' => $email,
            'code' => $code,
        ], $headers)->assertOk()->json();
    }

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
            throw new RuntimeException('No OTP email was captured for the test address.');
        }

        return $code;
    }
}
