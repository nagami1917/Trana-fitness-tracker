<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Goal extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'daily_calories',
        'daily_distance_km',
        'daily_active_min',
        'weekly_calories',
        'weekly_distance_km',
        'carb_target_g',
    ];

    protected function casts(): array
    {
        return [
            'daily_calories' => 'integer',
            'daily_distance_km' => 'float',
            'daily_active_min' => 'integer',
            'weekly_calories' => 'integer',
            'weekly_distance_km' => 'float',
            'carb_target_g' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
