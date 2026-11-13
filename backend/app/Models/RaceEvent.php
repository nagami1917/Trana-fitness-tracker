<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RaceEvent extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'title',
        'activity_type',
        'race_date',
        'distance_km',
        'elevation_gain_m',
        'goal_time_min',
        'carb_loading_enabled',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'race_date' => 'date',
            'distance_km' => 'float',
            'elevation_gain_m' => 'integer',
            'goal_time_min' => 'float',
            'carb_loading_enabled' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
