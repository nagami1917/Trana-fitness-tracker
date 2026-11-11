<?php

namespace App\Console\Commands;

use App\Models\ErrorLog;
use Illuminate\Console\Command;

/**
 * Read-model for the error store until the admin viewer lands:
 * groups the open faults by fingerprint, newest first.
 */
class ErrorsReport extends Command
{
    protected $signature = 'errors:report
                            {--since=24h : Look-back window (e.g. 24h, 7d, 0 for all)}
                            {--all : Include acknowledged/resolved rows}
                            {--limit=30 : Maximum rows}';

    protected $description = 'List grouped production errors recorded by the error monitor';

    public function handle(): int
    {
        $since = $this->option('since');
        $query = ErrorLog::query()->orderByDesc('last_seen_at')->limit(max(1, (int) $this->option('limit')));

        if ($this->option('all')) {
            // No status filter.
        } else {
            $query->where('status', 'open');
        }

        if ($since !== '0' && $since !== null && $since !== '') {
            // "24h" / "7d" / "30m" — plain numbers are minutes; "0" = all time.
            $amount = max(0, (int) $since);
            $from = match (substr((string) $since, -1)) {
                'd' => now()->subDays($amount),
                'h' => now()->subHours($amount),
                'm' => now()->subMinutes($amount),
                default => now()->subMinutes($amount),
            };
            $query->where('last_seen_at', '>=', $from);
        }

        $rows = $query->get();

        if ($rows->isEmpty()) {
            $this->info('No errors recorded.');

            return self::SUCCESS;
        }

        $this->table(
            ['hits', 'last seen', 'kind', 'status', 'message', 'fingerprint'],
            $rows->map(fn (ErrorLog $e) => [
                $e->occurrences,
                $e->last_seen_at->diffForHumans(short: true),
                $e->kind,
                $e->status,
                mb_strimwidth($e->message, 0, 70, '…'),
                substr($e->fingerprint, 0, 12),
            ])
        );

        $this->info($rows->sum('occurrences') . ' occurrence(s) across ' . $rows->count() . ' group(s).');

        return self::SUCCESS;
    }
}
