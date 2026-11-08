<?php

// Dependency-free smoke test for 2026_11_08_000003_add_user_profile_spec_fields.
// Run with: php backend/scripts/test_user_profile_migration.php
namespace Illuminate\Database\Migrations {
    abstract class Migration {}
}

namespace Illuminate\Database\Schema {
    class Blueprint
    {
        public static array $added = [];
        public static array $dropped = [];
        public static string $last = '';

        public function decimal(string $column, int $total = 8, int $places = 2): self
        {
            self::$last = $column;
            return $this;
        }

        public function string(string $column, int $length = 255): self
        {
            self::$last = $column;
            return $this;
        }

        public function nullable(): self
        {
            return $this;
        }

        public function default(mixed $value): self
        {
            return $this;
        }

        public function dropColumn(string $column): self
        {
            self::$dropped[] = $column;
            return $this;
        }
    }
}

namespace Illuminate\Support\Facades {
    class Schema
    {
        /** Columns the fake table already has. */
        public static array $columns = [];

        public static function hasColumn(string $table, string $column): bool
        {
            return in_array($column, self::$columns, true);
        }

        public static function table(string $table, callable $callback): void
        {
            $blueprint = new \Illuminate\Database\Schema\Blueprint();
            $callback($blueprint);
            $blueprintClass = \Illuminate\Database\Schema\Blueprint::class;
            if ($blueprintClass::$last !== '') {
                self::$columns[] = $blueprintClass::$last;
                $blueprintClass::$added[] = $blueprintClass::$last;
                $blueprintClass::$last = '';
            }
        }
    }

    class DB
    {
        public static string $driver = 'sqlite';
        public static int $version = 170000;
        public static array $roles = ['anon', 'authenticated'];
        public static array $statements = [];

        public static function getDriverName(): string
        {
            return self::$driver;
        }

        public static function select(string $sql): array
        {
            return array_map(fn ($role) => (object) ['rolname' => $role], self::$roles);
        }

        public static function selectOne(string $sql, array $bindings = []): object
        {
            return (object) ['server_version_num' => self::$version];
        }

        public static function statement(string $sql): bool
        {
            self::$statements[] = $sql;
            return true;
        }
    }
}

namespace {
    use Illuminate\Database\Schema\Blueprint;
    use Illuminate\Support\Facades\DB;
    use Illuminate\Support\Facades\Schema;

    function check(bool $condition, string $message): void
    {
        if (! $condition) {
            throw new RuntimeException($message);
        }
    }

    function lastView(): string
    {
        foreach (array_reverse(DB::$statements) as $sql) {
            if (str_starts_with($sql, 'CREATE VIEW')) {
                return $sql;
            }
        }

        throw new RuntimeException('No CREATE VIEW statement was issued');
    }

    $migration = require __DIR__.'/../database/migrations/2026_11_08_000003_add_user_profile_spec_fields.php';

    // --- SQLite (backend test suite) -----------------------------------------
    $migration->up();
    check(Blueprint::$added === ['activity_experience', 'fitness_level_source'], 'SQLite should add both Step 4 columns');
    $sql = implode("\n", DB::$statements);
    check(str_contains($sql, 'DROP VIEW IF EXISTS user_profiles'), 'The old projection must be replaced');
    check(str_contains(lastView(), "strftime('%Y', 'now')"), 'SQLite needs the strftime year expression');
    check(! str_contains($sql, 'security_invoker'), 'SQLite has no security_invoker');
    check(! str_contains($sql, 'revoke'), 'SQLite has no role grants');

    // --- PostgreSQL (Supabase) ------------------------------------------------
    // A fresh Postgres database: neither Step 4 column exists yet.
    DB::$driver = 'pgsql';
    DB::$statements = [];
    Schema::$columns = [];
    Blueprint::$added = [];

    $migration->up();
    check(Blueprint::$added === ['activity_experience', 'fitness_level_source'], 'Postgres should add both Step 4 columns');
    $view = lastView();

    foreach (['id', 'user_id', 'age', 'sex', 'height_cm', 'weight_kg', 'fitness_level', 'activity_experience', 'created_at', 'updated_at'] as $column) {
        check(str_contains($view, $column), "user_profiles is missing the spec column: {$column}");
    }
    check(str_contains($view, 'experience_level as fitness_level'), 'fitness_level must alias experience_level');
    check(str_contains($view, 'cast(extract(year from current_date) as integer) - birth_year'), 'age must be derived from birth_year');
    check(! str_contains($view, 'birth_year as'), 'birth_year must not be projected under another name');

    $sql = implode("\n", DB::$statements);
    check(str_contains($sql, 'alter view public."user_profiles" set (security_invoker = true)'), 'The recreated view must keep security_invoker');
    check(str_contains($sql, 'revoke all privileges on table public."user_profiles" from PUBLIC'), 'PUBLIC must lose access');
    check(str_contains($sql, 'from "anon"') && str_contains($sql, 'from "authenticated"'), 'Data API roles must lose access');

    // --- rollback restores the previous projection ---------------------------
    DB::$statements = [];
    Blueprint::$dropped = [];
    $migration->down();

    $view = lastView();
    check(str_contains($view, 'sweat_profile') && str_contains($view, 'onboarded_at'), 'Rollback must restore the pre-Step-4 view');
    check(! str_contains($view, 'activity_experience'), 'Rollback must drop the Step 4 column from the view');
    check(Blueprint::$dropped === ['fitness_level_source', 'activity_experience'], 'Rollback must drop both Step 4 columns');

    // A second run is a no-op: both columns already exist.
    DB::$statements = [];
    Blueprint::$added = [];
    Blueprint::$dropped = [];
    $migration->up();
    check(Blueprint::$added === [], 'Re-running must not re-add existing columns');

    echo "Step 4 user-profile migration SQL, view definition and rollback verified\n";
}
