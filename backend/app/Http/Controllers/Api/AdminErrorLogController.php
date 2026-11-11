<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ErrorLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Read-only error-log viewer with a status workflow
 * (open → acknowledged → resolved) for the admin console. Full traces are
 * shown here because the audience is the operator — the table itself is
 * RLS-locked against the public Data API.
 */
class AdminErrorLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['nullable', 'in:all,open,acknowledged,resolved'],
            'kind' => ['nullable', 'in:all,api,client,ml'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = ErrorLog::query()->orderByDesc('last_seen_at')->orderByDesc('id');

        if (($status = $validated['status'] ?? 'open') !== 'all') {
            $query->where('status', $status);
        }
        if (($kind = $validated['kind'] ?? 'all') !== 'all') {
            $query->where('kind', $kind);
        }

        $rows = $query->paginate($validated['limit'] ?? 30, ['*'], 'page', $validated['page'] ?? 1);

        return response()->json([
            'data' => $rows->getCollection()->map(fn (ErrorLog $log) => $this->row($log))->values(),
            'meta' => [
                'current_page' => $rows->currentPage(),
                'last_page' => $rows->lastPage(),
                'per_page' => $rows->perPage(),
                'total' => $rows->total(),
            ],
        ]);
    }

    /** Move one group through the triage workflow. */
    public function update(Request $request, int $errorId): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['required', 'in:open,acknowledged,resolved'],
        ]);

        $errorLog = ErrorLog::findOrFail($errorId);
        $errorLog->update(['status' => $validated['status']]);

        return response()->json(['data' => $this->row($errorLog->refresh())]);
    }

    private function row(ErrorLog $log): array
    {
        return [
            'id' => $log->id,
            'kind' => $log->kind,
            'level' => $log->level,
            'status' => $log->status,
            'message' => $log->message,
            'exception_class' => $log->exception_class,
            'route' => $log->route,
            'method' => $log->method,
            'fingerprint' => $log->fingerprint,
            'occurrences' => $log->occurrences,
            'trace' => $log->trace,
            'context' => $log->context,
            'first_seen_at' => $log->first_seen_at?->toIso8601String(),
            'last_seen_at' => $log->last_seen_at?->toIso8601String(),
        ];
    }
}
