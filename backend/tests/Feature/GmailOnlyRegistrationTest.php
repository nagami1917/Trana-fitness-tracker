<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class GmailOnlyRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = 'test-password-123';

    public function test_non_gmail_sign_up_is_rejected(): void
    {
        foreach (['person@example.com', 'person@yahoo.com', 'person@gmail.com.evil.com', 'person@notgmail.com'] as $email) {
            $this->postJson('/api/auth/register', [
                'name' => 'Gate Check',
                'email' => $email,
                'password' => self::PASSWORD,
            ])->assertStatus(422)->assertJsonValidationErrors(['email']);

            app('auth')->forgetGuards();
        }
    }

    public function test_gmail_sign_up_is_allowed_case_insensitively(): void
    {
        $this->postJson('/api/auth/register', [
            'name' => 'Gmail Athlete',
            'email' => 'Person@GMAIL.COM',
            'password' => self::PASSWORD,
        ])->assertCreated()->assertJsonPath('user.email', 'person@gmail.com');
    }
}
