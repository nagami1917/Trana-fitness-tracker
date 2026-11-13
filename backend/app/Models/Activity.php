<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Activity extends Model
{
    use HasFactory;

    public const TYPES = ['run', 'ride', 'walk', 'hike'];

    protected $fillable = [
        'user_id',
        'gear_id',
        'activity_type',
        'distance_km',
        'elevation_gain_m',
        'duration_min',
        'calories',
        'avg_heart_rate',
        'started_at',
        'ended_at',
        'average_speed',
        'average_pace',
        'route',
        'route_geojson',
        'notes',
        'source',
    ];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'gear_id' => 'integer',
            'distance_km' => 'float',
            'elevation_gain_m' => 'integer',
            'duration_min' => 'float',
            'calories' => 'integer',
            'avg_heart_rate' => 'integer',
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'average_speed' => 'float',
            'average_pace' => 'float',
            'route' => 'array',
            'route_geojson' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function gear(): BelongsTo
    {
        return $this->belongsTo(Gear::class);
    }

    public function activityPoints(): HasMany
    {
        return $this->hasMany(ActivityPoint::class)->ordered();
    }

    public function scopeGpsTracked(Builder $query): Builder
    {
        return $query->whereNotNull('route_geojson');
    }

    public function scopeForType(Builder $query, ?string $type): Builder
    {
        return $type ? $query->where('activity_type', $type) : $query;
    }
}
