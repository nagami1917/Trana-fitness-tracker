<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('category', 20)->default('gel'); // gel | drink | chew | food | salt
            $table->decimal('carbs_g', 6, 1)->default(0);
            $table->unsignedInteger('sodium_mg')->default(0);
            $table->unsignedInteger('fluid_ml')->default(0);
            $table->unsignedInteger('calories')->default(0);
            $table->string('serving_label', 40)->default('serving');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['user_id', 'category']);
        });

        $this->secureDataApi('fuel_items');
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_items');
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
