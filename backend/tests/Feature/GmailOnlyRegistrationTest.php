<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\EmailOtpTestHelpers;
use Tests\TestCase;

class GmailOnlyRegistrationTest extends TestCase
{
    use RefreshDatabase;
    use EmailOtpTestHelpers;

    public function test_non_gmail_sign_up_is_rejected(): void
    {
        foreach (['person@example.com', 'person@yahoo.com', 'person@gmail.com.evil.com', 'person@notgmail.com'] as $email) {
            $this->postJson('/api/auth/register', [
                'name' => 'Gate Check',
                'email' => $email,
            ])->assertStatus(422)->assertJsonValidationErrors(['email']);
        }
    }

    public function test_gmail_sign_up_is_allowed_case_insensitively_and_passwordless(): void
    {
        $response = $this->registerWithOtp('Gmail Athlete', 'Person@GMAIL.COM');

        $this->assertSame('person@gmail.com', $response['user']['email']);
        $this->assertDatabaseHas('users', [
            'email' => 'person@gmail.com',
            'password' => null,
        ]);
    }
}
