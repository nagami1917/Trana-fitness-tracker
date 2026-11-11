<?php

namespace Tests\Feature;

use App\Models\ErrorLog;
use App\Models\User;
use App\Services\MlClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminAccessTest extends TestCase
{
    use RefreshDatabase;

    /** Register returns a fresh token; guards are cleared (they persist in-process). */
    private function registerAthlete(string $email, string $name = 'Athlete'): array
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => $name,
            'email' => $email,
            'password' => 'test-password-123',
        ])->assertCreated();

        app('auth')->forgetGuards();

        return ['id' => $response->json('user.id'), 'token' => $response->json('token')];
    }

    private function makeAdmin(int $userId): void
    {
        User::findOrFail($userId)->forceFill(['role' => User::ROLE_ADMIN])->save();
        app('auth')->forgetGuards();
    }

    private function admin(): array
    {
        $admin = $this->registerAthlete('console.admin@gmail.com', 'Console Admin');
        $this->makeAdmin($admin['id']);

        return $admin;
    }

    private function bearer(array $user): array
    {
        return ['Authorization' => 'Bearer '.$user['token']];
    }

    // ------------------------------------------------------------------ gate

    public function test_every_admin_endpoint_forbids_plain_athletes(): void
    {
        $athlete = $this->registerAthlete('plain.athlete@gmail.com');
        $headers = $this->bearer($athlete);

        foreach (['/api/admin/dashboard', '/api/admin/users', '/api/admin/model', '/api/admin/errors'] as $path) {
            $this->getJson($path, $headers)->assertForbidden();
        }

        $this->patchJson("/api/admin/users/{$athlete['id']}/suspend", [], $headers)->assertForbidden();
        $this->patchJson('/api/admin/errors/1', ['status' => 'acknowledged'], $headers)->assertForbidden();
    }

    public function test_guests_are_rejected_before_the_role_check(): void
    {
        $this->getJson('/api/admin/dashboard')->assertUnauthorized();
    }

    // -------------------------------------------------------------- dashboard

    public function test_dashboard_reports_operational_kpis_for_admins(): void
    {
        $admin = $this->admin();
        $this->registerAthlete('second.athlete@gmail.com');

        $response = $this->getJson('/api/admin/dashboard', $this->bearer($admin))->assertOk();

        $response->assertJsonStructure([
            'data' => [
                'users' => ['total', 'new_7d', 'suspended', 'admins'],
                'content' => ['activities', 'predictions', 'goals'],
                'errors' => ['open_groups', 'groups_24h', 'total_groups'],
            ],
        ]);

        $this->assertGreaterThanOrEqual(2, $response->json('data.users.total'));
        $this->assertSame(0, $response->json('data.users.suspended'));
        $this->assertGreaterThanOrEqual(1, $response->json('data.users.admins'));
    }

    // ----------------------------------------------------------------- users

    public function test_users_list_searches_and_reports_suspension_state(): void
    {
        $admin = $this->admin();
        $this->registerAthlete('alpha.rider@gmail.com', 'Alpha Rider');
        $this->registerAthlete('beta.runner@gmail.com', 'Beta Runner');

        $all = $this->getJson('/api/admin/users', $this->bearer($admin))->assertOk();
        $all->assertJsonCount(3, 'data')
            ->assertJsonStructure(['meta' => ['current_page', 'last_page', 'per_page', 'total']])
            ->assertJsonPath('meta.total', 3);

        $search = $this->getJson('/api/admin/users?q=alpha', $this->bearer($admin))->assertOk();
        $search->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', 'alpha.rider@gmail.com');
        $search->assertJsonPath('data.0.role', 'athlete');
        $this->assertArrayHasKey('activities_count', $search->json('data.0'));

        $suspend = $this->patchJson("/api/admin/users/{$search->json('data.0.id')}/suspend", [], $this->bearer($admin))
            ->assertOk();
        $this->assertNotNull($suspend->json('data.suspended_at'));

        $suspended = $this->getJson('/api/admin/users?status=suspended', $this->bearer($admin))->assertOk();
        $suspended->assertJsonCount(1, 'data');
    }

    public function test_suspension_blocks_login_and_requests_until_reactivated(): void
    {
        $admin = $this->admin();
        $victim = $this->registerAthlete('suspended.athlete@gmail.com');
        $victimAuth = $this->bearer($victim);

        // This test alternates admin/victim tokens: auth guards cache their
        // resolved user for the whole test process — clear on every switch.
        $switch = fn () => app('auth')->forgetGuards();

        $switch();
        $suspend = $this->patchJson("/api/admin/users/{$victim['id']}/suspend", [], $this->bearer($admin))
            ->assertOk();
        $this->assertNotNull($suspend->json('data.suspended_at'));

        // Live session dies immediately (token revoked + middleware re-check).
        $switch();
        $this->getJson('/api/auth/me', $victimAuth)->assertForbidden();
        // And a fresh login is refused with a clear reason.
        $this->postJson('/api/auth/login', [
            'email' => 'suspended.athlete@gmail.com',
            'password' => 'test-password-123',
        ])->assertStatus(403)->assertJsonPath('message', 'This account has been suspended.');

        $switch();
        $this->patchJson("/api/admin/users/{$victim['id']}/reactivate", [], $this->bearer($admin))
            ->assertOk()
            ->assertJsonPath('data.suspended_at', null);

        // The revoked token stays dead; a new login works again.
        $switch();
        $this->getJson('/api/auth/me', $victimAuth)->assertUnauthorized();
        $this->postJson('/api/auth/login', [
            'email' => 'suspended.athlete@gmail.com',
            'password' => 'test-password-123',
        ])->assertOk()->assertJsonPath('user.role', 'athlete');
    }

    public function test_admin_cannot_suspend_their_own_account(): void
    {
        $admin = $this->admin();

        $this->patchJson("/api/admin/users/{$admin['id']}/suspend", [], $this->bearer($admin))
            ->assertForbidden()
            ->assertJsonPath('message', 'You cannot suspend your own account.');

        $this->assertNull(User::findOrFail($admin['id'])->suspended_at);
    }

    // ----------------------------------------------------------------- model

    public function test_model_viewer_passes_through_read_only_info(): void
    {
        app()->instance(MlClient::class, new class extends MlClient
        {
            public function configured(): bool
            {
                return true;
            }

            public function modelInfo(): array
            {
                return ['version' => '20261108.0445', 'metrics' => ['mae_min' => 5.65]];
            }
        });

        $admin = $this->admin();

        $this->getJson('/api/admin/model', $this->bearer($admin))
            ->assertOk()
            ->assertJsonPath('data.version', '20261108.0445')
            ->assertJsonPath('data.metrics.mae_min', 5.65);
    }

    public function test_model_viewer_answers_503_when_ml_is_down_or_unconfigured(): void
    {
        $admin = $this->admin();

        foreach ([['status' => 'unavailable'], ['status' => 'not_configured']] as $reply) {
            app()->instance(MlClient::class, new class($reply) extends MlClient
            {
                public function __construct(private array $reply)
                {
                }

                public function modelInfo(): array
                {
                    return $this->reply;
                }
            });

            $this->getJson('/api/admin/model', $this->bearer($admin))->assertStatus(503);
        }
    }

    // ---------------------------------------------------------------- errors

    public function test_error_log_viewer_lists_and_triages_groups(): void
    {
        $admin = $this->admin();

        $log = ErrorLog::create([
            'kind' => 'api',
            'level' => 'error',
            'fingerprint' => str_repeat('e', 40),
            'message' => 'Something went wrong on our side',
            'exception_class' => 'RuntimeException',
            'route' => '/api/activities',
            'method' => 'POST',
            'occurrences' => 4,
            'trace' => 'RuntimeException: boom @ x.php:1',
            'status' => 'open',
            'first_seen_at' => now(),
            'last_seen_at' => now(),
        ]);

        $list = $this->getJson('/api/admin/errors', $this->bearer($admin))->assertOk();
        $list->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $log->id)
            ->assertJsonPath('data.0.occurrences', 4)
            ->assertJsonPath('data.0.status', 'open');

        $this->patchJson("/api/admin/errors/{$log->id}", ['status' => 'acknowledged'], $this->bearer($admin))
            ->assertOk()
            ->assertJsonPath('data.status', 'acknowledged');

        $this->getJson('/api/admin/errors?status=open', $this->bearer($admin))
            ->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/admin/errors?status=acknowledged', $this->bearer($admin))
            ->assertOk()->assertJsonCount(1, 'data');

        $this->patchJson("/api/admin/errors/{$log->id}", ['status' => 'nonsense'], $this->bearer($admin))
            ->assertStatus(422);
    }

    // ----------------------------------------------------------- bootstrapping

    public function test_promote_command_grants_admin_and_is_idempotent(): void
    {
        $athlete = $this->registerAthlete('future.admin@gmail.com');

        $this->artisan('admin:promote', ['email' => 'Future.Admin@Gmail.com'])
            ->expectsOutputToContain('is now an admin')
            ->assertSuccessful();

        $this->assertTrue(User::findOrFail($athlete['id'])->isAdmin());

        $this->artisan('admin:promote', ['email' => 'future.admin@gmail.com'])
            ->expectsOutputToContain('already an admin')
            ->assertSuccessful();

        $this->artisan('admin:promote', ['email' => 'nobody@gmail.com'])->assertFailed();
    }

    public function test_session_shape_exposes_the_role_for_nav_gating(): void
    {
        $athlete = $this->registerAthlete('shaped.athlete@gmail.com');
        $this->makeAdmin($athlete['id']);

        $this->postJson('/api/auth/login', [
            'email' => 'shaped.athlete@gmail.com',
            'password' => 'test-password-123',
        ])->assertOk()->assertJsonPath('user.role', 'admin');
    }
}
