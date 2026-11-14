<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Protect the ML endpoints from abuse: 60 predictions / minute / user.
        RateLimiter::for('predictions', function (Request $request) {
            return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
        });

        // Authentication and OTP endpoints are cheaper to abuse than ordinary writes.
        RateLimiter::for('auth', function (Request $request) {
            return Limit::perMinute(10)->by($request->ip());
        });

        // Mutating endpoints (log/delete activities, update goals, account
        // deletion, CSV export…) — generous for humans, bounded for abuse.
        RateLimiter::for('writes', function (Request $request) {
            return Limit::perMinute(120)->by($request->user()?->id ?: $request->ip());
        });

        // Client-error intake: browsers may burst after a fault, but the
        // endpoint stores no value to an attacker — keep it cheap and bounded.
        RateLimiter::for('errors', function (Request $request) {
            return Limit::perMinute(60)->by($request->ip());
        });
    }
}
