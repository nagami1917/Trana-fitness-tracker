<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GoalEvent extends Model
{
    protected $fillable = [
        'user_id',
        'activity_id',
        'date',
        'goal_key',
        'target',
        'achieved_value',
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date',
            'target' => 'float',
            'achieved_value' => 'float',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function activity(): BelongsTo
    {
        return $this->belongsTo(Activity::class);
    }
}
