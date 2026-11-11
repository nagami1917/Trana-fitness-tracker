<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A grouped production fault. Identical (kind, fingerprint) reports bump
 * `occurrences` instead of creating rows — see App\Services\ErrorMonitor.
 */
class ErrorLog extends Model
{
    protected $fillable = [
        'user_id',
        'kind',
        'level',
        'fingerprint',
        'message',
        'exception_class',
        'route',
        'method',
        'occurrences',
        'context',
        'trace',
        'status',
        'first_seen_at',
        'last_seen_at',
    ];

    protected function casts(): array
    {
        return [
            'occurrences' => 'integer',
            'context' => 'array',
            'first_seen_at' => 'datetime',
            'last_seen_at' => 'datetime',
        ];
    }
}
