<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DatabaseConfigurationTest extends TestCase
{
    public function test_postgres_uses_individual_fields_instead_of_database_urls(): void
    {
        // phpunit.xml sets conflicting fake DB_URL / DATABASE_URL values.
        $config = config('database.connections.pgsql');
        $this->assertSame('pgsql', $config['driver']);
        $this->assertNull($config['url']);
        $this->assertSame('fields-host.invalid', $config['host']);
        $this->assertSame('fields-user', $config['username']);
        $this->assertSame('5432', (string) $config['port']);
        $this->assertSame('require', $config['sslmode']);

        // Creating the connection object is lazy; this checks Laravel's URL
        // parser without opening a socket or using any real credentials.
        $connection = DB::connection('pgsql');
        $this->assertSame('fields-host.invalid', $connection->getConfig('host'));
        $this->assertSame('fields-user', $connection->getConfig('username'));
    }

    public function test_sqlite_test_connection_also_ignores_database_urls(): void
    {
        $this->assertSame('sqlite', config('database.default'));
        $this->assertNull(config('database.connections.sqlite.url'));
        $this->assertSame(':memory:', DB::connection()->getConfig('database'));
    }
}
