<?php

/*
|--------------------------------------------------------------------------
| Frontend origin
|--------------------------------------------------------------------------
| Absolute URL of the SPA. Email links (verification, password reset) point
| here; the API only signs or consumes them. Defined as config (not a bare
| env() call in code) so `php artisan config:cache` keeps working.
*/

return [
    'url' => env('FRONTEND_URL', env('APP_URL', 'http://localhost:5173')),
];
