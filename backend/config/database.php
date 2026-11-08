<?php

/*
 * TRANA uses PostgreSQL in production and SQLite in tests. Laravel 11 merges
 * these connection definitions with its framework defaults. Explicitly disable
 * connection URLs on both supported connections: a stale DB_URL (or
 * DATABASE_URL) must not silently replace the individual DB_* values.
 */
return [
    'default' => env('DB_CONNECTION', 'pgsql'),

    'connections' => [
        'pgsql' => [
            'driver' => 'pgsql',
            'url' => null,
            'host' => env('DB_HOST') ?: 'YOUR_SESSION_POOLER_HOST',
            'port' => env('DB_PORT', '5432'),
            'database' => env('DB_DATABASE', 'postgres'),
            'username' => env('DB_USERNAME') ?: 'YOUR_SESSION_POOLER_USERNAME',
            'password' => env('DB_PASSWORD', ''),
            'charset' => env('DB_CHARSET', 'utf8'),
            'prefix' => '',
            'prefix_indexes' => true,
            'search_path' => env('DB_SEARCH_PATH', 'public'),
            'sslmode' => env('DB_SSLMODE', 'require'),
        ],

        'sqlite' => [
            'driver' => 'sqlite',
            'url' => null,
            'database' => env('DB_DATABASE', database_path('database.sqlite')),
            'prefix' => '',
            'foreign_key_constraints' => env('DB_FOREIGN_KEYS', true),
            'busy_timeout' => null,
            'journal_mode' => null,
            'synchronous' => null,
        ],
    ],
];
