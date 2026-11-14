<?php

/*
|--------------------------------------------------------------------------
| Frontend origin
|--------------------------------------------------------------------------
| Absolute URL of the SPA, retained for frontend URL generation.
| Defined as config so `php artisan config:cache` keeps working.
*/

return [
    'url' => env('FRONTEND_URL', env('APP_URL', 'http://localhost:5173')),
];
