<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('fitness_profiles', 'resting_hr')) {
            Schema::table('fitness_profiles', function (Blueprint $table) {
                $table->unsignedSmallInteger('resting_hr')->nullable();
            });
        }
        if (! Schema::hasColumn('fitness_profiles', 'max_hr')) {
            Schema::table('fitness_profiles', function (Blueprint $table) {
                $table->unsignedSmallInteger('max_hr')->nullable();
            });
        }
        if (! Schema::hasColumn('fitness_profiles', 'hr_zones')) {
            Schema::table('fitness_profiles', function (Blueprint $table) {
                $table->jsonb('hr_zones')->nullable();
            });
        }
    }

    public function down(): void
    {
        foreach (['hr_zones', 'max_hr', 'resting_hr'] as $column) {
            if (Schema::hasColumn('fitness_profiles', $column)) {
                Schema::table('fitness_profiles', function (Blueprint $table) use ($column) {
                    $table->dropColumn($column);
                });
            }
        }
    }
};
