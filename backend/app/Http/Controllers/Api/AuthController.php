<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\RegisterRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(RegisterRequest $request): JsonResponse
    {
        $user = User::create($request->validated());
        $user->ensureProfile();
        $user->ensureGoals();

        return response()->json([
            'token' => $user->createToken('pwa')->plainTextToken,
            'user' => $this->userPayload($user),
        ], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['nullable', 'string', 'max:60'],
        ]);

        $user = User::where('email', $credentials['email'])->first();

        if (! $user || ! Hash::check($credentials['password'], $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
        }

        $user->ensureProfile();
        $user->ensureGoals();

        return response()->json([
            'token' => $user->createToken($credentials['device_name'] ?? 'pwa')->plainTextToken,
            'user' => $this->userPayload($user),
        ]);
    }

    /**
     * Demo login: hands out a token for a shared read-mostly sandbox account so
     * reviewers can try TRANA without signing up. Disabled in production unless
     * DEMO_MODE=true.
     */
    public function demo(Request $request): JsonResponse
    {
        abort_unless(
            config('app.env') !== 'production' || env('DEMO_MODE', false),
            403,
            'Demo sign-in is disabled on this deployment.'
        );

        $email = env('DEMO_EMAIL', 'demo@trana.app');
        $user = User::firstOrCreate(
            ['email' => $email],
            [
                'name' => 'Nagami',
                'password' => Hash::make(env('DEMO_PASSWORD', 'trana-demo')),
            ]
        );

        $user->ensureProfile();
        $user->ensureGoals();

        if ($user->activities()->count() === 0) {
            \Database\Seeders\DemoSeeder::seedActivitiesFor($user);
        }

        return response()->json([
            'token' => $user->createToken('demo')->plainTextToken,
            'user' => $this->userPayload($user),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->userPayload($request->user())]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->json(['message' => 'Signed out.']);
    }

    private function userPayload(User $user): array
    {
        $profile = $user->fitnessProfile;

        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'profile' => $profile,
            'created_at' => $user->created_at?->toIso8601String(),
        ];
    }
}
