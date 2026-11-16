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

    /**
     * The user's activities. The relation itself is not date-bounded — it is
     * the shape `loadSessionActivities()` eager-loads with the day constraint,
     * so it must exist for that call (and for `with('activities')`) to work.
     */
    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class, 'user_id', 'user_id');
    }

    /**
     * Eager-load the activities recorded on this session's calendar day.
     *
     * A daily session is just a date bucket, so its "accomplished" routes are
     * the activities whose `started_at` falls inside that day. `started_at` is
     * a timezone-aware column and the app runs in APP_TIMEZONE, so the window
     * is built the same way GoalEventRecorder does: [dayStart, dayEnd) at
     * midnight, half-open, so a midnight activity lands on exactly one day.
     *
     * This is an instance method rather than a query scope on purpose: the
     * boundaries depend on this row's date, and the relation must stay scoped
     * to this user's activities.
     */
    public function loadSessionActivities(): self
    {
        $start = $this->session_date->copy()->startOfDay();
        $end = $start->copy()->addDay();

        return $this->load(['activities' => function ($relation) use ($start, $end) {
            $relation
                ->where('started_at', '>=', $start)
                ->where('started_at', '<', $end)
                ->orderBy('started_at')
                ->select([
                    'id',
                    'user_id',
                    'activity_type',
                    'distance_km',
                    'duration_min',
                    'calories',
                    'started_at',
                    'route',
                    'route_geojson',
                    'source',
                ]);
        }]);
    }

    public function scopeForUser(Builder $query, int $userId): Builder
    {
        return $query->where('user_id', $userId);
    }

    public function scopeForDate(Builder $query, string $date): Builder
    {
        return $query->whereDate('session_date', $date);
    }

    public function scopeBetweenDates(Builder $query, string $from, string $to): Builder
    {
        return $query->whereDate('session_date', '>=', $from)->whereDate('session_date', '<=', $to);
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
