<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

// Nightly: refresh the duration model from real Supabase data.
Schedule::command('trana:retrain')->dailyAt('03:00')->withoutOverlapping();
