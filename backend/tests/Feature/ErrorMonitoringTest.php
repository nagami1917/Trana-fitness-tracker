<?php

namespace Tests\Feature;

use App\Models\ErrorLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class ErrorMonitoringTest extends TestCase
{
    use RefreshDatabase;

    public function test_client_error_reports_are_grouped_and_counted(): void
    {
        $payload = [
            'message' => 'Cannot read properties of undefined (reading chart)',
            'stack' => 'TypeError: Cannot read …\n    at drawChart (analytics.js:42:11)',
            'route' => '/analytics',
            'app_version' => '1.0.0',
        ];

        $this->postJson('/api/client-errors', $payload)->assertStatus(202);
        $this->postJson('/api/client-errors', $payload)->assertStatus(202);

        $this->assertSame(1, ErrorLog::count());

        $log = ErrorLog::first();
        $this->assertSame('client', $log->kind);
        $this->assertSame('warning', $log->level);
        $this->assertSame(2, $log->occurrences);
        $this->assertSame(40, strlen($log->fingerprint));
        $this->assertSame('/analytics', $log->route);
        $this->assertStringContainsString('Cannot read properties', $log->message);
        $this->assertSame('open', $log->status);
    }

    public function test_different_messages_create_separate_groups(): void
    {
        $this->postJson('/api/client-errors', ['message' => 'boom one'])->assertStatus(202);
        $this->postJson('/api/client-errors', ['message' => 'boom two'])->assertStatus(202);

        $this->assertSame(2, ErrorLog::count());
    }

    public function test_client_error_payload_requires_a_message(): void
    {
        $this->postJson('/api/client-errors', [])->assertStatus(422);
        $this->assertSame(0, ErrorLog::count());
    }

    public function test_uncaught_server_exceptions_are_recorded_and_still_render_as_json(): void
    {
        Route::get('/api/__monitor-boom', function () {
            throw new \RuntimeException('database connection lost');
        });

        $response = $this->getJson('/api/__monitor-boom');

        // The framework still owns the response: generic 500 JSON, no trace leak.
        $response->assertStatus(500)->assertJsonPath('message', 'Something went wrong on our side.');

        $log = ErrorLog::where('kind', 'api')->firstOrFail();
        $this->assertSame('error', $log->level);
        $this->assertSame('RuntimeException', $log->exception_class);
        $this->assertStringContainsString('database connection lost', $log->message);
        $this->assertSame('/api/__monitor-boom', $log->route);
        $this->assertSame(40, strlen($log->fingerprint));
        $this->assertStringContainsString('RuntimeException', (string) $log->trace);
    }

    public function test_client_facing_4xx_failures_are_not_recorded(): void
    {
        $this->getJson('/api/definitely-not-a-route')->assertStatus(404);

        $this->assertSame(0, ErrorLog::count());
    }

    public function test_report_command_lists_open_errors(): void
    {
        ErrorLog::create([
            'kind' => 'client',
            'level' => 'warning',
            'fingerprint' => str_repeat('a', 64),
            'message' => 'Chart crashed on load',
            'exception_class' => 'ClientError',
            'occurrences' => 3,
            'status' => 'open',
            'first_seen_at' => now(),
            'last_seen_at' => now(),
        ]);

        $this->artisan('errors:report')
            ->expectsOutputToContain('Chart crashed on load')
            ->expectsOutputToContain('3 occurrence(s) across 1 group(s).')
            ->assertSuccessful();
    }

    public function test_ml_kind_is_accepted_and_kept_separate_from_browser_errors(): void
    {
        $this->postJson('/api/client-errors', ['message' => 'prediction service timeout', 'kind' => 'ml'])
            ->assertStatus(202);
        $this->postJson('/api/client-errors', ['message' => 'prediction service timeout', 'kind' => 'client'])
            ->assertStatus(202);

        $this->assertSame(2, ErrorLog::count());
        $this->assertSame('error', ErrorLog::where('kind', 'ml')->firstOrFail()->level);
    }

    public function test_recording_survives_without_a_session_user(): void
    {
        // Anonymous browser faults (login page) must never break the intake.
        $this->postJson('/api/client-errors', ['message' => 'login page render failed'])
            ->assertStatus(202);

        $this->assertNull(ErrorLog::first()->user_id);
    }
}
