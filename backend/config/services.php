<?php

return [
    // Public OAuth client ID, shared with the Svelte Vite build. The backend
    // uses it only to verify the ID-token audience; no client secret is used.
    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
    ],
];
