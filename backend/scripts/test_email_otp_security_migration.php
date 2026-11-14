<?php

// Dependency-free smoke test for the private OTP-table security migration.
// Run with: php backend/scripts/test_email_otp_security_migration.php
namespace Illuminate\Database\Migrations {
    abstract class Migration {}
}

namespace Illuminate\Support\Facades {
    class DB
    {
        public static string $driver = 'sqlite';
        public static array $roles = ['anon', 'authenticated'];
        public static array $statements = [];

        public static function getDriverName(): string { return self::$driver; }
        public static function select(string $sql): array
        {
            return array_map(fn ($role) => (object) ['rolname' => $role], self::$roles);
        }
        public static function statement(string $sql): bool
        {
            self::$statements[] = $sql;
            return true;
        }
    }
}

namespace {
    use Illuminate\Support\Facades\DB;

    function check(bool $condition, string $message): void
    {
        if (! $condition) {
            throw new \RuntimeException($message);
        }
    }

    $migration = require __DIR__.'/../database/migrations/2026_11_14_000002_secure_email_otp_challenges.php';
    $migration->up();
    check(DB::$statements === [], 'SQLite should not receive PostgreSQL security statements');

    DB::$driver = 'pgsql';
    $migration->up();
    check(count(DB::$statements) === 7, 'Expected RLS plus revokes for PUBLIC, anon and authenticated');
    foreach ([
        'alter table public."email_otp_challenges" enable row level security',
        'revoke all privileges on table public."email_otp_challenges" from PUBLIC',
        'revoke all privileges on table public."email_otp_challenges" from "anon"',
        'revoke all privileges on table public."email_otp_challenges" from "authenticated"',
        'revoke all privileges on sequence public."email_otp_challenges_id_seq" from "authenticated"',
    ] as $expected) {
        check(in_array($expected, DB::$statements, true), "Missing SQL: {$expected}");
    }

    $beforeRollback = DB::$statements;
    $migration->down();
    check(DB::$statements === $beforeRollback, 'Rollback must not expose the OTP table to Data API roles');
    echo "Email OTP security migration smoke checks passed\n";
}
