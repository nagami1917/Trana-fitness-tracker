<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class GoogleAuthNonceService
{
    public function issue(): string
    {
        $nonce = Str::random(64);
        Cache::put($this->cacheKey($nonce), true, now()->addMinutes(10));

        return $nonce;
    }

    public function consume(string $nonce): void
    {
        $key = $this->cacheKey($nonce);
        $consumed = Cache::lock($key.'.consume-lock', 5)->block(5, function () use ($key): bool {
            return Cache::pull($key) === true;
        });

        if (! $consumed) {
            throw ValidationException::withMessages([
                'credential' => ['This Google sign-in attempt has expired or was already used. Please try again.'],
            ]);
        }
    }

    private function cacheKey(string $nonce): string
    {
        return 'google.oauth.nonce.'.hash('sha256', $nonce);
    }
}
