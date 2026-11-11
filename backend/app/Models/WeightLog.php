<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

class WeightLog extends Model
{
    protected $fillable = [
        'user_id',
        'weight_kg',
        'measured_at',
    ];

    protected function casts(): array
    {
        return [
            'weight_kg' => 'float',
            'measured_at' => 'date',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Record a daily weigh-in: one row per (user, day) — re-logging a date
     * replaces it. When this is the athlete's newest date, the profile weight
     * (what the prediction model reads) is refreshed to match.
     *
     * Date equality uses whereDate() so SQLite's "Y-m-d 00:00:00" text
     * serialization and Postgres' DATE coercion both match.
     */
    public static function record(User $user, float $weightKg, ?string $measuredAt = null): self
    {
        $date = Carbon::parse($measuredAt ?? 'today')->toDateString();

        $log = static::where('user_id', $user->id)
            ->whereDate('measured_at', $date)
            ->first();

        if ($log) {
            $log->update(['weight_kg' => $weightKg]);
        } else {
            $log = static::create([
                'user_id' => $user->id,
                'weight_kg' => $weightKg,
                'measured_at' => $date,
            ]);
        }

        $hasNewer = static::where('user_id', $user->id)
            ->where('measured_at', '>', $date)
            ->exists();

        if (! $hasNewer) {
            $user->ensureProfile()->update(['weight_kg' => $weightKg]);
        }

        return $log;
    }
}
