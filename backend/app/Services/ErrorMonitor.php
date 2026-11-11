<?php

namespace App\Services;

use App\Models\ErrorLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Error monitoring: fingerprint, group and persist production faults.
 *
 * Three sources land in one table:
 *   api    — uncaught server exceptions (RecordServerErrors middleware)
 *   client — browser JS errors / failed fetches (POST /api/client-errors)
 *   ml     — FastAPI faults forwarded to the same intake (kind = ml)
 *
 * Contract: record() must NEVER throw — monitoring may not take down the
 * very request it is observing. Every path is wrapped defensively.
 */
final class ErrorMonitor
{
    private const MAX_MESSAGE = 1000;

    private const MAX_TRACE = 4000;

    /**
     * Persist an uncaught server exception for the current request.
     */
    public static function recordServer(Throwable $e, Request $request): void
    {
        self::guard(function () use ($e, $request) {
            $userId = null;
            try {
                // Default guard first (session), then the Sanctum bearer
                // guard — API routes never run session auth middleware.
                $userId = $request->user()?->id
                    ?? auth('sanctum')->user()?->id;
            } catch (Throwable) {
                // Guard itself blew up (broken token, etc.) — no user link.
            }

            self::persist([
                'kind' => 'api',
                'level' => 'error',
                'fingerprint' => self::fingerprint('api', get_class($e), $e->getMessage(), self::topFrame($e)),
                'message' => self::clip($e->getMessage() ?: get_class($e)),
                'exception_class' => get_class($e),
                'route' => self::clip($request->getPathInfo(), 200),
                'method' => $request->getMethod(),
                'user_id' => $userId,
                'context' => [
                    'user_agent' => self::clip((string) $request->userAgent(), 200),
                    'app_env' => config('app.env'),
                ],
                'trace' => self::formatTrace($e),
            ]);
        });
    }

    /**
     * Persist a browser/ML report arriving over HTTP (validated input).
     *
     * @param  array{message:string, stack?:string, route?:string, kind?:string, app_version?:string}  $input
     */
    public static function recordReport(array $input, ?int $userId = null): void
    {
        self::guard(function () use ($input, $userId) {
            $kind = in_array($input['kind'] ?? 'client', ['client', 'ml'], true)
                ? $input['kind']
                : 'client';
            $message = self::clip($input['message']);
            $stack = self::clip($input['stack'] ?? '', self::MAX_TRACE);
            $topLine = self::firstStackLine($stack);

            self::persist([
                'kind' => $kind,
                // Browser noise is a warning; the ML service failing is a fault.
                'level' => $kind === 'ml' ? 'error' : 'warning',
                'fingerprint' => self::fingerprint($kind, $kind === 'ml' ? 'MlServiceError' : 'ClientError', $message, $topLine),
                'message' => $message,
                'exception_class' => $kind === 'ml' ? 'MlServiceError' : 'ClientError',
                'route' => self::clip($input['route'] ?? '', 200) ?: null,
                'method' => null,
                'user_id' => $userId,
                'context' => [
                    'app_version' => self::clip($input['app_version'] ?? '', 40) ?: null,
                    'top_frame' => $topLine ?: null,
                ],
                'trace' => $stack ?: null,
            ]);
        });
    }

    /**
     * Upsert by (kind, fingerprint): repeat hits bump the counter.
     * A unique-key race (two first occurrences at once) falls back to a
     * counter update instead of failing the caller's request.
     */
    private static function persist(array $attrs): void
    {
        $key = ['kind' => $attrs['kind'], 'fingerprint' => $attrs['fingerprint']];

        $existing = ErrorLog::where($key)->first();

        if ($existing) {
            $existing->increment('occurrences');
            $existing->forceFill(['last_seen_at' => now()])->save();

            return;
        }

        try {
            ErrorLog::create($attrs + ['occurrences' => 1, 'status' => 'open', 'first_seen_at' => now(), 'last_seen_at' => now()]);
        } catch (\Illuminate\Database\QueryException $e) {
            // Unique violation: someone else inserted the same fingerprint.
            ErrorLog::where($key)->increment('occurrences');
        }

        Log::warning('[error-monitor]', [
            'kind' => $attrs['kind'],
            'fingerprint' => $attrs['fingerprint'],
            'message' => $attrs['message'],
        ]);
    }

    /** sha1 over kind + class + message + origin frame → stable grouping key. */
    private static function fingerprint(string $kind, string $class, string $message, string $origin): string
    {
        return sha1($kind . '|' . $class . '|' . $message . '|' . $origin);
    }

    /** First trace frame outside vendor/ (falls back to the very first). */
    private static function topFrame(Throwable $e): string
    {
        foreach ($e->getTrace() as $frame) {
            $file = $frame['file'] ?? '';
            if ($file === '' || str_contains($file, '/vendor/') || str_contains($file, '\\vendor\\')) {
                continue;
            }

            return $file . ':' . ($frame['line'] ?? '?');
        }

        $file = $e->getFile();
        return $file . ':' . $e->getLine();
    }

    private static function firstStackLine(string $stack): string
    {
        foreach (preg_split('/\r?\n/', $stack) ?: [] as $line) {
            $line = trim($line);
            if ($line !== '') {
                return self::clip($line, 300);
            }
        }

        return '';
    }

    private static function formatTrace(Throwable $e): string
    {
        $lines = [get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine()];

        foreach (array_slice($e->getTrace(), 0, 20) as $frame) {
            $lines[] = sprintf(
                '  at %s:%s %s%s%s%s()',
                $frame['file'] ?? '-',
                $frame['line'] ?? '-',
                $frame['class'] ?? '',
                $frame['type'] ?? '',
                '',
                $frame['function'] ?? '?'
            );
        }

        if ($previous = $e->getPrevious()) {
            $lines[] = 'caused by ' . get_class($previous) . ': ' . $previous->getMessage();
        }

        return self::clip(implode("\n", $lines), self::MAX_TRACE);
    }

    private static function clip(string $value, int $max = self::MAX_MESSAGE): string
    {
        $value = trim($value);

        return mb_strlen($value) > $max ? mb_substr($value, 0, $max - 1) . '…' : $value;
    }

    /** Monitoring must never break the observed request. */
    private static function guard(callable $fn): void
    {
        try {
            $fn();
        } catch (Throwable $e) {
            try {
                Log::error('[error-monitor] failed to record an error', ['exception' => $e::class . ': ' . $e->getMessage()]);
            } catch (Throwable) {
                // Nowhere left to report — swallow: the request continues.
            }
        }
    }
}
