<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * User management: read-only listing + suspend/reactivate. No role editing
 * over HTTP (bootstrap with `php artisan admin:promote`), no deletions
 * (accounts erase themselves via DELETE /account), no mass actions —
 * one account per request, actor-guarded against self-lockout.
 */
class AdminUserController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:all,active,suspended'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = User::query()
            ->withCount('activities')
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        if ($q = trim($validated['q'] ?? '')) {
            $needle = '%' . strtolower($q) . '%';
            $query->where(function ($builder) use ($needle) {
                $builder->whereRaw('lower(name) like ?', [$needle])
                    ->orWhereRaw('lower(email) like ?', [$needle]);
            });
        }

        match ($validated['status'] ?? 'all') {
            'suspended' => $query->whereNotNull('suspended_at'),
            'active' => $query->whereNull('suspended_at'),
            default => null,
        };

        $rows = $query->paginate($validated['limit'] ?? 25, ['*'], 'page', $validated['page'] ?? 1);

        return response()->json([
            'data' => $rows->getCollection()->map(fn (User $user) => $this->row($user) + [
                'activities_count' => (int) $user->activities_count,
            ])->values(),
            'meta' => [
                'current_page' => $rows->currentPage(),
                'last_page' => $rows->lastPage(),
                'per_page' => $rows->perPage(),
                'total' => $rows->total(),
            ],
        ]);
    }

    /** Suspend one account: flag it and revoke every API token it holds. */
    public function suspend(Request $request, int $userId): JsonResponse
    {
        $user = User::findOrFail($userId);

        if ($user->id === $request->user()->id) {
            return response()->json(['message' => 'You cannot suspend your own account.'], 403);
        }

        if (! $user->isSuspended()) {
            $user->forceFill(['suspended_at' => now()])->save();
            $user->tokens()->delete();
        }

        return response()->json(['data' => $this->row($user->refresh())]);
    }

    /** Lift a suspension. Login and requests work again on the next sign-in. */
    public function reactivate(Request $request, int $userId): JsonResponse
    {
        $user = User::findOrFail($userId);

        if ($user->isSuspended()) {
            $user->forceFill(['suspended_at' => null])->save();
        }

        return response()->json(['data' => $this->row($user->refresh())]);
    }

    private function row(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'suspended_at' => $user->suspended_at?->toIso8601String(),
            'email_verified_at' => $user->email_verified_at?->toIso8601String(),
            'created_at' => $user->created_at?->toIso8601String(),
        ];
    }
}
