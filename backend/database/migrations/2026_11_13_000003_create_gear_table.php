<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('gear', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('brand', 60)->nullable();
            $table->string('sport', 16)->default('run'); // run | ride | walk | hike | all
            $table->decimal('initial_km', 8, 2)->default(0);
            $table->decimal('logged_km', 8, 2)->default(0);
            $table->decimal('max_km', 8, 2)->default(650);
            $table->boolean('is_default')->default(false);
            $table->boolean('retired')->default(false);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'sport']);
        });

        if (! Schema::hasColumn('activities', 'gear_id')) {
            Schema::table('activities', function (Blueprint $table) {
                if (DB::getDriverName() === 'sqlite') {
                    $table->unsignedBigInteger('gear_id')->nullable()->index();
                } else {
                    $table->foreignId('gear_id')->nullable()->constrained('gear')->nullOnDelete();
                }
            });
        }

        $this->secureDataApi('gear');
    }

    public function down(): void
    {
        if (Schema::hasColumn('activities', 'gear_id')) {
            Schema::table('activities', function (Blueprint $table) {
                if (DB::getDriverName() === 'sqlite') {
                    $table->dropColumn('gear_id');
                } else {
                    $table->dropConstrainedForeignId('gear_id');
                }
            });
        }
        Schema::dropIfExists('gear');
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
