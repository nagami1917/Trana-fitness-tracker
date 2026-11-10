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

    protected $fillable = ['name', 'email', 'password'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
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
