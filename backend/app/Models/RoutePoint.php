<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One vertex of a planned route, in sequence order.
 */
class RoutePoint extends Model
{
    use HasFactory;

    protected $fillable = [
        'route_id',
        'latitude',
        'longitude',
        'altitude',
        'sequence',
    ];

    protected function casts(): array
    {
        return [
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'altitude' => 'decimal:2',
            'sequence' => 'integer',
        ];
    }

    public function route(): BelongsTo
    {
        return $this->belongsTo(PlannedRoute::class);
    }

    public function scopeOrdered(Builder $query): Builder
    {
        return $query->orderBy('sequence');
    }
}
