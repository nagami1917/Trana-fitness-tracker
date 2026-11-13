<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FuelItem extends Model
{
    use HasFactory;

    public const CATEGORIES = ['gel', 'drink', 'chew', 'food', 'salt'];

    protected $fillable = [
        'user_id',
        'name',
        'category',
        'carbs_g',
        'sodium_mg',
        'fluid_ml',
        'calories',
        'serving_label',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'carbs_g' => 'float',
            'sodium_mg' => 'integer',
            'fluid_ml' => 'integer',
            'calories' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
