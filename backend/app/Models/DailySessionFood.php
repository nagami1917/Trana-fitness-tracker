<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One food item logged within a daily session.
 * Meal type: breakfast, lunch, dinner, or snack.
 * Food name is free-text — no predefined dataset required.
 */
class DailySessionFood extends Model
{
    use HasFactory;

    protected $fillable = [
        'daily_session_id',
        'meal_type',
        'food_name',
        'calories',
        'carbs_g',
        'protein_g',
        'fat_g',
        'quantity',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'daily_session_id' => 'integer',
            'meal_type' => 'string',
            'food_name' => 'string',
            'calories' => 'integer',
            'carbs_g' => 'integer',
            'protein_g' => 'integer',
            'fat_g' => 'integer',
            'quantity' => 'integer',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function dailySession(): BelongsTo
    {
        return $this->belongsTo(DailySession::class);
    }

    public const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

    public function scopeForMeal(Builder $query, string $mealType): Builder
    {
        return $query->where('meal_type', $mealType);
    }
}
