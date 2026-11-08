<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Database\Seeders\DemoSeeder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DemoController extends Controller
{
    /** Wipe and regenerate the demo athlete's activities (demo environments only). */
    public function reset(Request $request): JsonResponse
    {
        abort_if(config('app.env') === 'production' && ! env('DEMO_MODE', false), 403, 'Not available.');

        $user = $request->user();
        $user->activities()->delete();
        $user->predictions()->delete();
        DemoSeeder::seedActivitiesFor($user, resetProfile: true);

        return response()->json(['reset' => true, 'activities' => $user->activities()->count()]);
    }
}
