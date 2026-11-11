<?php

namespace App\Http\Middleware;

use App\Services\ErrorMonitor;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Global outermost middleware: records every unescaped server fault
 * (5xx-class) into the error-monitoring store, then rethrows so the
 * framework's exception handling — JSON rendering, default logging —
 * behaves exactly as before.
 *
 * Deliberate client-facing failures (404/401/403/422/429 …) are NOT
 * server faults and are skipped.
 */
class RecordServerErrors
{
    public function handle(Request $request, Closure $next): Response
    {
        try {
            return $next($request);
        } catch (Throwable $e) {
            if (! $this->isServerFault($e)) {
                throw $e;
            }

            ErrorMonitor::recordServer($e, $request);

            throw $e;
        }
    }

    private function isServerFault(Throwable $e): bool
    {
        // Framework exceptions that render as 4xx are expected protocol
        // outcomes, not production faults.
        if ($e instanceof HttpExceptionInterface && $e->getStatusCode() < 500) {
            return false;
        }

        if ($e instanceof AuthenticationException
            || $e instanceof AuthorizationException
            || $e instanceof ValidationException
            || $e instanceof ModelNotFoundException) {
            return false;
        }

        return true;
    }
}
