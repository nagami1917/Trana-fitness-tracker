<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use App\Models\DailySession;
use App\Models\EnergyExpenditure;
use App\Models\PlannedRoute;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    /** Application-level role allowlist — anything else is not an admin. */
    public const ROLE_ATHLETE = 'athlete';

    public const ROLE_ADMIN = 'admin';

    protected $fillable = ['name', 'email', 'password', 'role', 'suspended_at'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'suspended_at' => 'datetime',
        ];
    }

    /** The `admin` middleware trusts only this check — never client input. */
    public function isAdmin(): bool
    {
        return $this->role === self::ROLE_ADMIN;
    }

    public function isSuspended(): bool
    {
        return $this->suspended_at !== null;
    }

    /**
     * Swap Laravel's default reset notification (which needs the web route
     * `password.reset`) for our SPA-friendly one that links to /reset-password
     * on the frontend origin. Signature must match the CanResetPassword trait
     * exactly — untyped $token — or PHP fatals on class load.
     */
    public function sendPasswordResetNotification(#[\SensitiveParameter] $token)
    {
        $this->notify(new \App\Notifications\ResetPasswordNotification($token));
    }

    public function fitnessProfile(): HasOne
    {
        return $this->hasOne(FitnessProfile::class);
    }

    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class);
    }

    public function plannedRoutes(): HasMany
    {
        return $this->hasMany(PlannedRoute::class);
    }

    public function predictions(): HasMany
    {
        return $this->hasMany(Prediction::class);
    }

    public function goal(): HasOne
    {
        return $this->hasOne(Goal::class);
    }

    public function energyExpenditure(): HasMany
    {
        return $this->hasMany(EnergyExpenditure::class);
    }

    public function dailySessions(): HasMany
    {
        return $this->hasMany(DailySession::class)->orderByDesc('session_date');
    }

    public function fuelItems(): HasMany
    {
        return $this->hasMany(FuelItem::class);
    }

    public function gear(): HasMany
    {
        return $this->hasMany(Gear::class);
    }

    public function raceEvents(): HasMany
    {
        return $this->hasMany(RaceEvent::class)->orderBy('race_date');
    }

    public function pushSubscriptions(): HasMany
    {
        return $this->hasMany(PushSubscription::class);
    }

    /** Create the paired rows every athlete needs, with sensible defaults. */
    public function ensureProfile(): FitnessProfile
    {
        return $this->fitnessProfile()->firstOrCreate([], [
            'weight_kg' => 60,
            'height_cm' => 168,
            'birth_year' => (int) date('Y') - 28,
            'sex' => 'other',
            'sweat_profile' => 'normal',
            'experience_level' => 1,
            'typical_temperature_c' => 26,
            'units' => 'metric',
        ]);
    }

    public function ensureGoals(): Goal
    {
        $weight = (float) ($this->fitnessProfile?->weight_kg ?? 60);

        return $this->goal()->firstOrCreate([], [
            'daily_calories' => 2400,
            'daily_distance_km' => 10,
            'daily_active_min' => 60,
            'weekly_calories' => 12000,
            'weekly_distance_km' => 40,
            'carb_target_g' => (int) round($weight * 6),
        ]);
    }
}
