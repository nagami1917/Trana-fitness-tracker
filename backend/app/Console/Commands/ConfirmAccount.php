<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Signup verification is a hard gate: registration always sends an email code
 * and only a verified account can reach the app. If the deployment has no
 * working mail transport yet, that would leave every new account locked out.
 *
 * This command is the deliberate, server-side way out. It creates or verifies
 * one account the operator asked for — never in bulk, and never through an
 * HTTP endpoint that a stranger could reach. When it unlocks an account the
 * operator must provide the new password, so a known/guessable default can
 * never exist.
 */
class ConfirmAccount extends Command
{
    protected $signature = 'account:confirm
        {email : Email address of the account to create or unlock}
        {--name= : Display name (required when the account does not exist yet)}
        {--username= : Username to use when creating the account}
        {--password= : New password for the account; prompted for when omitted}';

    protected $description = 'Create a verified account, or clear the email-verification gate on an existing one';

    public function handle(): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('Provide a valid email address.');

            return self::FAILURE;
        }

        $user = User::query()->where('email', $email)->first();

        return $user ? $this->unlock($user) : $this->create($email);
    }

    private function create(string $email): int
    {
        $name = trim((string) $this->option('name'));
        if ($name === '') {
            $this->error('--name is required when the account does not exist yet.');

            return self::FAILURE;
        }

        $username = $this->username(
            (string) ($this->option('username') ?: Str::before($email, '@')),
            null,
        );
        $password = $this->password();
        if ($password === null) {
            return self::FAILURE;
        }

        $user = DB::transaction(function () use ($name, $username, $email, $password): User {
            $user = new User();
            $user->forceFill([
                'name' => mb_substr(strip_tags($name), 0, 80),
                'username' => $username,
                'email' => $email,
                'password' => Hash::driver('bcrypt')->make($password),
                'role' => User::ROLE_ATHLETE,
                // Google is never involved: this is a password TRANA account.
                'google_sub' => null,
            ])->save();

            return $user;
        });

        // The email is confirmed by the operator, so mark it verified and give
        // the account the same starter profile/goals a normal signup gets.
        $user->forceFill(['email_verified_at' => now()])->save();
        $user->ensureProfile();
        $user->ensureGoals();

        $this->info("Created verified account {$email} (id {$user->id}, username {$username}).");
        $this->line('No verification email was sent.');

        return self::SUCCESS;
    }

    private function unlock(User $user): int
    {
        if ($user->isSuspended()) {
            $this->error("{$user->email} is suspended. Reactivate it before confirming.");

            return self::FAILURE;
        }

        if ($user->email_verified_at) {
            $this->info("{$user->email} is already verified (id {$user->id}).");

            return self::SUCCESS;
        }

        $password = $this->password();
        if ($password === null) {
            return self::FAILURE;
        }

        DB::transaction(function () use ($user, $password): void {
            $user->forceFill([
                'email_verified_at' => now(),
                'password' => Hash::driver('bcrypt')->make($password),
                // Any code still waiting in the inbox stops being useful.
                'remember_token' => null,
            ])->save();

            $user->ensureProfile();
            $user->ensureGoals();
        });

        $this->info("Confirmed {$user->email} (id {$user->id}) with a new password.");
        $this->line('Sign in with that password; no verification code is needed.');

        return self::SUCCESS;
    }

    /** Unique username, matching how the app names Google-created accounts. */
    private function username(string $base, ?int $userId): string
    {
        $base = strtolower((string) preg_replace('/[^a-z0-9_]+/', '_', $base));
        $base = trim($base, '_');
        if (strlen($base) < 3) {
            $base = 'athlete';
        }

        $candidate = substr($base, 0, 20);
        $attempt = 0;
        while (User::query()->where('username', $candidate)->exists()) {
            $attempt++;
            $suffix = '_'.$attempt;
            $candidate = substr($base, 0, 20 - strlen($suffix)).$suffix;
        }

        return $candidate;
    }

    /** Read the password from the option or a hidden prompt; never echo it. */
    private function password(): ?string
    {
        $password = $this->option('password');
        if (! is_string($password) || $password === '') {
            $password = $this->secret('New password for this account (min 8 characters)');
        }

        if (! is_string($password) || strlen($password) < 8 || strlen($password) > 72) {
            $this->error('The password must be between 8 and 72 characters.');

            return null;
        }

        return $password;
    }
}
