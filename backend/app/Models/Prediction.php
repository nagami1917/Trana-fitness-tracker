<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Prediction extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'activity_type',
        'distance_km',
        'elevation_gain_m',
        'route',
        'planned_for',
        'status',
        'duration_min',
        'duration_low_min',
        'duration_high_min',
        'confidence',
        'calories',
        'carbs_per_hour_g',
        'carbs_total_g',
        'sodium_per_hour_mg',
        'fluid_per_hour_ml',
        'intensity',
        'met',
        'payload',
        'model_version',
    ];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'distance_km' => 'float',
            'elevation_gain_m' => 'integer',
            'route' => 'array',
            'planned_for' => 'datetime',
            'duration_min' => 'float',
            'duration_low_min' => 'float',
            'duration_high_min' => 'float',
            'confidence' => 'float',
            'calories' => 'integer',
            'carbs_per_hour_g' => 'integer',
            'carbs_total_g' => 'integer',
            'sodium_per_hour_mg' => 'integer',
            'fluid_per_hour_ml' => 'integer',
            'met' => 'float',
            'payload' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Shape used by the Svelte client (camelCase, nested recommendation). */
    public function toApiArray(): array
    {
        return [
            'id' => $this->id,
            'activity_type' => $this->activity_type,
            'distance_km' => $this->distance_km,
            'elevation_gain_m' => $this->elevation_gain_m,
            'route' => $this->route,
            'planned_for' => $this->planned_for?->toIso8601String(),
            'status' => $this->status,
            'duration' => [
                'minutes' => $this->duration_min,
                'hours' => round($this->duration_min / 60, 2),
                'low' => $this->duration_low_min,
                'high' => $this->duration_high_min,
                'paceMinPerKm' => in_array($this->activity_type, ['run', 'walk', 'hike'], true) && $this->distance_km > 0
                    ? round($this->duration_min / $this->distance_km, 2)
                    : null,
                'speedKmh' => $this->distance_km > 0 ? round($this->distance_km / ($this->duration_min / 60), 2) : null,
                'confidence' => $this->confidence,
                'referenceSpeedKmh' => $this->payload['duration']['referenceSpeedKmh'] ?? null,
                'basis' => $this->payload['duration']['basis'] ?? null,
            ],
            'fueling' => $this->payload['fueling'] ?? [],
            'history_used' => $this->payload['history_used'] ?? null,
            // The profile values (Step 4) that informed this prediction.
            'profile' => $this->payload['profile'] ?? null,
            'model' => $this->payload['model'] ?? [],
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
