<?php

// Dependency-free smoke test for the migration's SQLite and Postgres paths.
// Run with: php backend/scripts/test_supabase_security_migration.php
namespace Illuminate\Database\Migrations {
    abstract class Migration {}
}

namespace Illuminate\Support\Facades {
    class DB
    {
        public static string $driver = 'sqlite';
        public static int $version = 170000;
        public static array $roles = ['anon', 'authenticated'];
        public static array $missing = [];
        public static array $statements = [];

        public static function getDriverName(): string { return self::$driver; }
        public static function select(string $sql): array
        {
            return array_map(fn ($role) => (object) ['rolname' => $role], self::$roles);
        }
        public static function selectOne(string $sql, array $bindings = []): object
        {
            if ($sql === 'show server_version_num') {
                return (object) ['server_version_num' => self::$version];
            }
            $name = str_replace('public.', '', $bindings[0]);
            return (object) ['present' => in_array($name, self::$missing, true) ? 0 : 1];
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

    $migration = require __DIR__.'/../database/migrations/2026_11_08_000002_secure_supabase_data_api.php';
    $migration->up();
    check(DB::$statements === [], 'SQLite should not receive PostgreSQL statements');

    DB::$driver = 'pgsql';
    $migration->up();
    $sql = DB::$statements;
    check(count($sql) === 111, 'Unexpected number of security statements');
    foreach ([
        'alter table public."users" enable row level security',
        'alter table public."personal_access_tokens" enable row level security',
        'alter view public."user_profiles" set (security_invoker = true)',
        'revoke all privileges on table public."users" from PUBLIC',
        'revoke all privileges on table public."users" from "anon"',
        'revoke all privileges on table public."user_profiles" from "authenticated"',
        'revoke all privileges on sequence public."users_id_seq" from "authenticated"',
    ] as $expected) {
        check(in_array($expected, $sql, true), "Missing SQL: {$expected}");
    }

    DB::$statements = [];
    DB::$version = 140000;
    DB::$roles = [];
    DB::$missing = ['v_athlete_pace', 'v_daily_totals', 'v_prediction_accuracy'];
    $migration->up();
    check(! array_filter(DB::$statements, fn ($sql) => str_contains($sql, 'security_invoker')), 'Postgres 14 cannot use security_invoker');
    check(! array_filter(DB::$statements, fn ($sql) => str_contains($sql, 'v_athlete_pace')), 'Missing optional views must be skipped');
    $beforeRollback = DB::$statements;
    $migration->down();
    check(DB::$statements === $beforeRollback, 'Rollback must not re-expose Data API roles');
    echo "Supabase security migration smoke checks passed\n";
}
