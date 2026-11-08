<?php

// Dependency-free checks for the database configuration. All values are fake.
// Run with: php backend/scripts/test_database_config.php
$testEnv = [
    'DB_CONNECTION' => 'pgsql',
    'DB_HOST' => 'fields-host.invalid',
    'DB_PORT' => '5432',
    'DB_DATABASE' => 'fields-database',
    'DB_USERNAME' => 'fields-user',
    'DB_PASSWORD' => 'fake-only',
    'DB_SSLMODE' => 'require',
    'DB_URL' => 'postgresql://url-host.invalid:6543/url-database',
    'DATABASE_URL' => 'postgresql://another-url.invalid:6543/url-database',
];

function env(string $key, mixed $default = null): mixed
{
    global $testEnv;

    return array_key_exists($key, $testEnv) ? $testEnv[$key] : $default;
}

function database_path(string $path): string
{
    return '/test/database/'.$path;
}

function ensure(bool $condition, string $message): void
{
    if (! $condition) {
        throw new RuntimeException($message);
    }
}

$config = require __DIR__.'/../config/database.php';
$pgsql = $config['connections']['pgsql'];
ensure($config['default'] === 'pgsql', 'Expected pgsql as the selected connection');
ensure($pgsql['driver'] === 'pgsql', 'Expected the pgsql driver');
ensure($pgsql['url'] === null, 'DB_URL or DATABASE_URL must not override PostgreSQL fields');
ensure($pgsql['host'] === 'fields-host.invalid', 'PostgreSQL host must come from DB_HOST');
ensure($pgsql['port'] === '5432', 'PostgreSQL port must come from DB_PORT');
ensure($pgsql['database'] === 'fields-database', 'PostgreSQL database must come from DB_DATABASE');
ensure($pgsql['username'] === 'fields-user', 'PostgreSQL username must come from DB_USERNAME');
ensure($pgsql['password'] === 'fake-only', 'PostgreSQL password must come from DB_PASSWORD');
ensure($pgsql['sslmode'] === 'require', 'PostgreSQL SSL must come from DB_SSLMODE');

$testEnv['DB_CONNECTION'] = 'sqlite';
$testEnv['DB_DATABASE'] = ':memory:';
$config = require __DIR__.'/../config/database.php';
ensure($config['default'] === 'sqlite', 'The SQLite test connection must remain selectable');
ensure($config['connections']['sqlite']['url'] === null, 'DB_URL must not override SQLite fields');
ensure($config['connections']['sqlite']['database'] === ':memory:', 'The SQLite test database must stay in memory');

unset($testEnv['DB_CONNECTION'], $testEnv['DB_SSLMODE'], $testEnv['DB_HOST'], $testEnv['DB_USERNAME']);
$config = require __DIR__.'/../config/database.php';
ensure($config['default'] === 'pgsql', 'Default connection should be pgsql');
ensure($config['connections']['pgsql']['sslmode'] === 'require', 'SSL should default to require');
ensure($config['connections']['pgsql']['host'] === 'YOUR_SESSION_POOLER_HOST', 'Missing host must not default to a live database');
ensure($config['connections']['pgsql']['username'] === 'YOUR_SESSION_POOLER_USERNAME', 'Missing username must remain an explicit placeholder');

echo "Database configuration smoke checks passed\n";
