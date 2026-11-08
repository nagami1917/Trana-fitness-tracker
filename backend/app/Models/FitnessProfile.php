<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FitnessProfile extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'weight_kg',
        'height_cm',
        'birth_year',
        'sex',
        'sweat_profile',
        'experience_level',
        'typical_temperature_c',
        'city',
        'units',
    ];

    protected function casts(): array
    {
        return [
            'weight_kg' => 'float',
            'height_cm' => 'float',
            'birth_year' => 'integer',
            'experience_level' => 'integer',
            'typical_temperature_c' => 'float',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function age(): int
    {
        return max(10, (int) date('Y') - (int) $this->birth_year);
    }
}
