<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Six-digit email verification, password-reset, and deletion codes. */
class EmailOtpNotification extends Notification
{
    public function __construct(
        public readonly string $code,
        public readonly string $recipientName,
        public readonly string $purpose,
        public readonly int $expiresInMinutes,
    ) {
    }

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        [$subject, $action] = match ($this->purpose) {
            'registration' => ['Verify your TRANA account', 'verify your email address'],
            'password_reset' => ['Reset your TRANA password', 'reset your password'],
            default => ['Confirm your TRANA account deletion', 'confirm deleting your account'],
        };

        return (new MailMessage)
            ->subject($subject)
            ->greeting('Hi '.$this->recipientName.'!')
            ->line('Enter this six-digit code to '.$action.':')
            ->line($this->code)
            ->line('This code expires in '.$this->expiresInMinutes.' minutes, works once, and allows up to five attempts.')
            ->line('If you did not request this code, you can safely ignore this email.');
    }

    public function toArray(object $notifiable): array
    {
        return [];
    }
}
