<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Password-reset link handed over by Laravel's password broker; the action
 * URL is the SPA's /reset-password page, which posts the token back to
 * POST /api/password/reset. Sent synchronously — no queue tables needed.
 */
class ResetPasswordNotification extends Notification
{
    public function __construct(public readonly string $token)
    {
    }

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $url = config('frontend.url').'/reset-password'
            .'?token='.rawurlencode($this->token)
            .'&email='.rawurlencode($notifiable->getEmailForPasswordReset());

        return (new MailMessage)
            ->subject('Reset your TRANA password')
            ->greeting('Hi '.$notifiable->name.'!')
            ->line('We received a request to reset your password.')
            ->action('Choose a new password', $url)
            ->line('This link expires in 60 minutes and can only be used once.')
            ->line('If you did not request this, ignore this email — your password stays unchanged.');
    }

    public function toArray(object $notifiable): array
    {
        return [];
    }
}
