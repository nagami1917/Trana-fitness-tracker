<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('race_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('title', 100);
            $table->string('activity_type', 16)->default('run');
            $table->date('race_date');
            $table->decimal('distance_km', 8, 2);
            $table->unsignedInteger('elevation_gain_m')->default(0);
            $table->decimal('goal_time_min', 8, 1)->nullable();
            $table->boolean('carb_loading_enabled')->default(true);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'race_date']);
        });

        $this->secureDataApi('race_events');
    }

    public function down(): void
    {
        Schema::dropIfExists('race_events');
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
