<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('push_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->text('endpoint');
            $table->string('endpoint_hash', 64);
            $table->string('public_key', 255)->nullable();
            $table->string('auth_token', 255)->nullable();
            $table->jsonb('preferences')->nullable();
            $table->timestampTz('last_used_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'endpoint_hash']);
        });

        $this->secureDataApi('push_subscriptions');
    }

    public function down(): void
    {
        Schema::dropIfExists('push_subscriptions');
    }

    private function secureDataApi(string $table): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $roles = ['PUBLIC'];
        foreach (DB::select("select rolname from pg_roles where rolname in ('anon', 'authenticated')") as $role) {
            $roles[] = '"'.$role->rolname.'"';
        }

        DB::statement("alter table public.\"{$table}\" enable row level security");
        DB::statement("revoke all privileges on sequence public.\"{$table}_id_seq\" from \"PUBLIC\"");
        foreach ($roles as $role) {
            DB::statement("revoke all privileges on table public.\"{$table}\" from {$role}");
            DB::statement("revoke all privileges on sequence public.\"{$table}_id_seq\" from {$role}");
        }
    }
};
