<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One wearable-reported session.
 *
 * Devices measure energy expenditure directly; TRANA estimates it from MET.
 * These samples are the ground truth the calibration factor is derived from —
 * see EnergyExpenditureService.
 */
class EnergyExpenditure extends Model
{
    use HasFactory;

    /** Wearables whose exports TRANA accepts. */
    public const DEVICE_TYPES = ['garmin', 'strava', 'polar', 'apple', 'coros', 'suunto', 'wahoo', 'whoop', 'other'];

    protected $fillable = [
        'user_id',
        'device_type',
        'activity_type',
        'distance_km',
        'duration_min',
        'avg_heart_rate',
        'weight_kg',
        'measured_calories',
        'recorded_at',
    ];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'distance_km' => 'float',
            'duration_min' => 'float',
            'avg_heart_rate' => 'integer',
            'weight_kg' => 'float',
            'measured_calories' => 'integer',
            'recorded_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function scopeForDevice(Builder $query, ?string $device): Builder
    {
        return $device ? $query->where('device_type', $device) : $query;
    }
}
