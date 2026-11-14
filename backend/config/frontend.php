<?php

/*
|--------------------------------------------------------------------------
| Frontend origin
|--------------------------------------------------------------------------
| Absolute URL of the SPA. Retained for other frontend URL generation; the
| passwordless email-code auth flow does not send verification or reset links.
| Defined as config so `php artisan config:cache` keeps working.
*/

return [
    'url' => env('FRONTEND_URL', env('APP_URL', 'http://localhost:5173')),
];
