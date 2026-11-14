<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Short-lived email code used to sign in or confirm account ownership. */
class EmailOtpNotification extends Notification
{
    public function __construct(
        public readonly string $code,
        public readonly string $recipientName,
        public readonly string $purpose,
    ) {
    }

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        [$subject, $action] = match ($this->purpose) {
            'registration' => ['Verify your TRANA email', 'verify your email and create your account'],
            'account_deletion' => ['Confirm your TRANA account deletion', 'confirm deleting your account'],
            default => ['Your TRANA sign-in code', 'sign in to TRANA'],
        };

        return (new MailMessage)
            ->subject($subject)
            ->greeting('Hi '.$this->recipientName.'!')
            ->line('Enter this six-digit code to '.$action.':')
            ->line($this->code)
            ->line('This code expires in 10 minutes and can only be used once.')
            ->line('If you did not request this code, you can safely ignore this email.');
    }

    public function toArray(object $notifiable): array
    {
        return [];
    }
}
