<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Short-lived email code used only for account-deletion confirmation. */
class EmailOtpNotification extends Notification
{
    public function __construct(
        public readonly string $code,
        public readonly string $recipientName,
    ) {
    }

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Confirm your TRANA account deletion')
            ->greeting('Hi '.$this->recipientName.'!')
            ->line('Enter this six-digit code to confirm deleting your account:')
            ->line($this->code)
            ->line('This code expires in 10 minutes and can only be used once.')
            ->line('If you did not request this code, you can safely ignore this email.');
    }

    public function toArray(object $notifiable): array
    {
        return [];
    }
}
