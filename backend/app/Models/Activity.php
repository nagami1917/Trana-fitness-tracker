<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Activity extends Model
{
    use HasFactory;

    public const TYPES = ['run', 'ride', 'walk', 'hike'];

    protected $fillable = [
        'user_id',
        'activity_type',
        'distance_km',
        'elevation_gain_m',
        'duration_min',
        'calories',
        'avg_heart_rate',
        'started_at',
        'route',
        'notes',
        'source',
    ];

    protected function casts(): array
    {
        return [
            'distance_km' => 'float',
            'elevation_gain_m' => 'integer',
            'duration_min' => 'float',
            'calories' => 'integer',
            'avg_heart_rate' => 'integer',
            'started_at' => 'datetime',
            'route' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function scopeForType(Builder $query, ?string $type): Builder
    {
        return $type ? $query->where('activity_type', $type) : $query;
    }
}
