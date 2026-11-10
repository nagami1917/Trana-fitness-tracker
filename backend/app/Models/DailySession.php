<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One daily session per user per day.
 * Tracks calories burned (activity map) vs calories eaten (food log).
 * Resets at midnight local time via unique session_date constraint.
 */
class DailySession extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'session_date',
        'calories_burned',
        'calories_eaten',
        'water_ml',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'session_date' => 'date',
            'calories_burned' => 'integer',
            'calories_eaten' => 'integer',
            'water_ml' => 'integer',
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function foods(): HasMany
    {
        return $this->hasMany(DailySessionFood::class)->orderBy('meal_type')->orderBy('created_at');
    }

    public function scopeForUser(Builder $query, int $userId): Builder
    {
        return $query->where('user_id', $userId);
    }

    public function scopeForDate(Builder $query, string $date): Builder
    {
        return $query->where('session_date', $date);
    }

    public function scopeBetweenDates(Builder $query, string $from, string $to): Builder
    {
        return $query->whereBetween('session_date', [$from, $to]);
    }

    public function getNetCaloriesAttribute(): int
    {
        return (int) $this->calories_eaten - (int) $this->calories_burned;
    }

    public function getSurplusDeficitAttribute(): string
    {
        $net = $this->net_calories;
        if ($net > 0) return "surplus (+{$net} kcal)";
        if ($net < 0) return "deficit ({$net} kcal)";
        return 'balanced';
    }
}
