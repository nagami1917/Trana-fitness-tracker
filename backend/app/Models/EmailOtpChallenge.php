<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EmailOtpChallenge extends Model
{
    protected $fillable = [
        'email',
        'name',
        'purpose',
        'code_hash',
        'expires_at',
        'attempts',
        'send_count',
        'send_window_started_at',
        'last_sent_at',
    ];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'send_window_started_at' => 'datetime',
            'last_sent_at' => 'datetime',
        ];
    }
}
