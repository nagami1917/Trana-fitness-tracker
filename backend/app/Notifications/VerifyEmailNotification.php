<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\URL;

/**
 * Email-verification link for the SPA. The action URL is a *signed* API
 * route (2h expiry) that verifies the address and redirects back to
 * /verify-email on the frontend. Sent synchronously — no queue tables needed.
 */
class VerifyEmailNotification extends Notification
{
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $url = URL::temporarySignedRoute(
            'verification.verify',
            now()->addHours(2),
            [
                'id' => $notifiable->getKey(),
                'hash' => sha1($notifiable->getEmailForVerification()),
            ],
        );

        return (new MailMessage)
            ->subject('Verify your TRANA email')
            ->greeting('Hi '.$notifiable->name.'!')
            ->line('Confirm your email address to secure your TRANA account.')
            ->action('Verify email', $url)
            ->line('This link expires in 2 hours.')
            ->line('If you did not create a TRANA account, you can safely ignore this email.');
    }

    public function toArray(object $notifiable): array
    {
        return [];
    }
}
