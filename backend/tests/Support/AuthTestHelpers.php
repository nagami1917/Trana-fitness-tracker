<?php

namespace Tests\Support;

use App\Models\User;
use Illuminate\Support\Facades\Hash;

/** Helpers for authenticated feature-test fixtures; auth flows have dedicated tests. */
trait AuthTestHelpers
{
    public const FIXTURE_PASSWORD = 'Fixture-password-123';

    /** @return array{token: string, user: array<string, mixed>} */
    protected function createVerifiedAccount(string $name, string $email): array
    {
        $email = strtolower(trim($email));
        $localPart = strtolower((string) strstr($email, '@', true));
        $base = preg_replace('/[^a-z0-9_]+/', '_', $localPart) ?? '';
        $base = trim($base, '_');
        if (strlen($base) < 3) {
            $base = 'runner';
        }

        $user = User::create([
            'name' => $name,
            'username' => substr($base, 0, 12).'_'.substr(hash('sha256', $email), 0, 7),
            'email' => $email,
            'password' => Hash::driver('bcrypt')->make(self::FIXTURE_PASSWORD),
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();
        $user->ensureProfile();
        $user->ensureGoals();

        return $this->makeTestSession($user);
    }

    /** @return array{token: string, user: array<string, mixed>} */
    protected function signInToAccount(string $email): array
    {
        $user = User::query()->where('email', strtolower(trim($email)))->firstOrFail();

        return $this->makeTestSession($user);
    }

    /** @return array{token: string, user: array<string, mixed>} */
    private function makeTestSession(User $user): array
    {
        $profile = $user->fitnessProfile;

        return [
            'token' => $user->createToken('feature-test')->plainTextToken,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'email' => $user->email,
                'role' => $user->role,
                'verified' => $user->email_verified_at !== null,
                'email_verified_at' => $user->email_verified_at?->toIso8601String(),
                'profile' => $profile,
            ],
        ];
    }
}
