<?php

return [
    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env(
            'GOOGLE_REDIRECT_URI',
            rtrim((string) env('APP_URL', 'http://localhost:8001'), '/').'/api/auth/google/callback',
        ),
        'authorization_url' => 'https://accounts.google.com/o/oauth2/v2/auth',
        'token_url' => 'https://oauth2.googleapis.com/token',
        'userinfo_url' => 'https://openidconnect.googleapis.com/v1/userinfo',
    ],
    'trana' => [
        // Signing up from the marketing/login page always requires the emailed
        // code. Google sign-in stays open, so this only closes the password
        // registration form (useful while a deployment has no working mailer).
        //
        // Closed by default. The failure path when this is open and the mailer
        // is not working is unrecoverable for the visitor: registration creates
        // the user row, the code fails to send, and the API answers 503 with
        // `email_verified_at` still null. That account can never sign in, and
        // the address is now taken, so the same person cannot retry. A closed
        // form answers 403 with a usable message instead. Set
        // TRANA_ALLOW_PASSWORD_SIGNUP=true only on a deployment whose mail
        // transport is verified to deliver.
        'allow_password_signup' => filter_var(
            env('TRANA_ALLOW_PASSWORD_SIGNUP', false),
            FILTER_VALIDATE_BOOL,
            FILTER_NULL_ON_FAILURE,
        ) ?? false,
        // Sanctum's opaque personal-access token lives only in this HttpOnly
        // cookie. It is never serialized into a browser-readable response.
        'auth_cookie' => env('TRANA_AUTH_COOKIE', 'trana_session'),
        'csrf_cookie' => env('TRANA_CSRF_COOKIE', 'trana_csrf'),
        'auth_cookie_minutes' => (int) env('TRANA_AUTH_COOKIE_MINUTES', 720),
        // AuthCookieService selects a production-safe default when this is
        // unset. Set TRANA_COOKIE_SAME_SITE=lax when the SPA and the API share
        // an origin behind a rewrite (see frontend/vercel.json): the cookie is
        // then first-party, `None` is unnecessary, and `Lax` keeps the session
        // working in browsers that block third-party cookies outright.
        'cookie_same_site' => env('TRANA_COOKIE_SAME_SITE'),
        // Leave blank (host-only cookie) unless the API is served from a
        // sibling subdomain of a real domain the deployment owns.
        'cookie_domain' => env('TRANA_COOKIE_DOMAIN'),
    ],
];
