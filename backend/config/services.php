<?php

return [
    'trana' => [
        // Sanctum's opaque personal-access token lives only in this HttpOnly
        // cookie. It is never serialized into a browser-readable response.
        'auth_cookie' => env('TRANA_AUTH_COOKIE', 'trana_session'),
        'csrf_cookie' => env('TRANA_CSRF_COOKIE', 'trana_csrf'),
        'auth_cookie_minutes' => (int) env('TRANA_AUTH_COOKIE_MINUTES', 720),
        'cookie_same_site' => strtolower((string) env('TRANA_COOKIE_SAME_SITE', 'lax')),
        'cookie_domain' => env('TRANA_COOKIE_DOMAIN'),
    ],
];
