<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One GPS sample of a tracked activity.
 */
class ActivityPoint extends Model
{
    use HasFactory;

    protected $fillable = [
        'activity_id',
        'latitude',
        'longitude',
        'altitude',
        'speed',
        'accuracy',
        'timestamp',
    ];

    protected function casts(): array
    {
        return [
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'altitude' => 'decimal:2',
            'speed' => 'decimal:2',
            'accuracy' => 'integer',
            'timestamp' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function activity(): BelongsTo
    {
        return $this->belongsTo(Activity::class);
    }

    public function scopeOrdered(Builder $query): Builder
    {
        return $query->orderBy('timestamp')->orderBy('id');
    }
}
