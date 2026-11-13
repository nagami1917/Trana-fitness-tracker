<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fitness_profiles', function (Blueprint $table) {
            if (! Schema::hasColumn('fitness_profiles', 'resting_hr')) {
                $table->unsignedSmallInteger('resting_hr')->nullable();
            }
            if (! Schema::hasColumn('fitness_profiles', 'max_hr')) {
                $table->unsignedSmallInteger('max_hr')->nullable();
            }
            if (! Schema::hasColumn('fitness_profiles', 'hr_zones')) {
                $table->jsonb('hr_zones')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('fitness_profiles', function (Blueprint $table) {
            foreach (['hr_zones', 'max_hr', 'resting_hr'] as $column) {
                if (Schema::hasColumn('fitness_profiles', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
