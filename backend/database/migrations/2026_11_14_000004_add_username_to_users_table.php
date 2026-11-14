<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('username', 20)->nullable()->unique();
        });

        // Existing Google-auth accounts keep working while they set a local
        // password through the recovery flow. Give each a unique, valid handle.
        DB::table('users')->select(['id', 'email'])->orderBy('id')->chunkById(100, function ($users): void {
            foreach ($users as $user) {
                $localPart = strtolower((string) strstr((string) $user->email, '@', true));
                $base = preg_replace('/[^a-z0-9_]+/', '_', $localPart) ?? '';
                $base = trim($base, '_');
                if (strlen($base) < 3) {
                    $base = 'athlete';
                }

                $suffix = '_'.$user->id;
                $username = substr($base, 0, 20 - strlen($suffix)).$suffix;
                DB::table('users')->where('id', $user->id)->update(['username' => $username]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['username']);
            $table->dropColumn('username');
        });
    }
};
