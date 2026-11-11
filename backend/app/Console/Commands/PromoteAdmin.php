<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Admin bootstrapping: the only way a role is granted. Deliberately CLI-only
 * — there is no HTTP endpoint that can mint admins, so compromising an
 * admin session can never create more admins.
 */
class PromoteAdmin extends Command
{
    protected $signature = 'admin:promote {email : Email of the existing account to make an admin}';

    protected $description = 'Grant the admin role to an existing account (server-side bootstrapping)';

    public function handle(): int
    {
        $email = strtolower(trim($this->argument('email')));

        $user = User::where('email', $email)->first();

        if (! $user) {
            $this->error("No account with email {$email}.");

            return self::FAILURE;
        }

        if ($user->isAdmin()) {
            $this->info("{$email} is already an admin.");

            return self::SUCCESS;
        }

        $user->forceFill(['role' => User::ROLE_ADMIN])->save();
        $this->info("{$email} is now an admin.");

        return self::SUCCESS;
    }
}
