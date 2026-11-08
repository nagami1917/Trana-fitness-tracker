<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'name' => 'TRANA API',
    'status' => 'ok',
    'docs' => '/api/docs',
    'version' => '1.0.0',
]));
