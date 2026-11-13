<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Gear extends Model
{
    use HasFactory;

    protected $table = 'gear';

    public const SPORTS = ['run', 'ride', 'walk', 'hike', 'all'];

    protected $fillable = [
        'user_id',
        'name',
        'brand',
        'sport',
        'initial_km',
        'logged_km',
        'max_km',
        'is_default',
        'retired',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'initial_km' => 'float',
            'logged_km' => 'float',
            'max_km' => 'float',
            'is_default' => 'boolean',
            'retired' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class);
    }

    public function totalKm(): float
    {
        return round((float) $this->initial_km + (float) $this->logged_km, 2);
    }

    /** Recompute logged distance strictly from persisted activities. */
    public function syncLoggedKm(): void
    {
        $sum = (float) $this->activities()->sum('distance_km');
        $this->update(['logged_km' => round($sum, 2)]);
    }
}
