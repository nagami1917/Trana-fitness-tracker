<?php

/*
|--------------------------------------------------------------------------
| Frontend origin
|--------------------------------------------------------------------------
| Absolute URL of the SPA. Retained for other frontend URL generation; Google
| Identity Services uses a popup rather than an application callback URL.
| Defined as config so `php artisan config:cache` keeps working.
*/

return [
    'url' => env('FRONTEND_URL', env('APP_URL', 'http://localhost:5173')),
];
