<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A route an athlete plans ahead of a session.
 * Geometry lives in route_geojson (GeoJSON); route_points is a denormalised
 * copy used by the map for fast rendering.
 */
class PlannedRoute extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'name',
        'distance_km',
        'estimated_duration_min',
        'elevation_gain_m',
        'route_geojson',
    ];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'distance_km' => 'decimal:3',
            'estimated_duration_min' => 'decimal:2',
            'elevation_gain_m' => 'integer',
            'route_geojson' => 'array',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function routePoints(): HasMany
    {
        return $this->hasMany(RoutePoint::class)->orderBy('sequence');
    }

    public function scopeForUser(Builder $query, int $userId): Builder
    {
        return $query->where('user_id', $userId);
    }
}
