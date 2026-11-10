<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Wearable-measured energy expenditure (e.g. WEEE dataset).
 * Used to calibrate TRANA's calorie estimates against real sensor data.
 */
class EnergyExpenditure extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'device_type',
        'activity_type',
        'distance_km',
        'duration_min',
        'avg_heart_rate',
        'max_heart_rate',
        'weight_kg',
        'height_cm',
        'age',
        'sex',
        'measured_calories',
        'trana_estimated_calories',
        'recorded_at',
    ];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'distance_km' => 'decimal:3',
            'duration_min' => 'decimal:2',
            'avg_heart_rate' => 'integer',
            'max_heart_rate' => 'integer',
            'weight_kg' => 'decimal:2',
            'height_cm' => 'decimal:1',
            'age' => 'integer',
            'measured_calories' => 'decimal:2',
            'trana_estimated_calories' => 'integer',
            'recorded_at' => 'datetime',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function scopeForUser(Builder $query, int $userId): Builder
    {
        return $query->where('user_id', $userId);
    }

    public function scopeWithMeasured(Builder $query): Builder
    {
        return $query->whereNotNull('measured_calories');
    }
}
