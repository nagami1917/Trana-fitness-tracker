<?php

return [
    // The API authenticates exclusively with Sanctum personal access tokens.
    // Do not fall back to the web/session guard: without CSRF middleware,
    // accepting an authenticated cookie would make writes vulnerable to CSRF.
    // Other Sanctum settings are merged from the package defaults.
    'guard' => [],
];
