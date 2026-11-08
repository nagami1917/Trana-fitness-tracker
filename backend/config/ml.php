<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Python ML service (FastAPI)
    |--------------------------------------------------------------------------
    | TRANA keeps prediction logic out of PHP: the Laravel API gathers the
    | athlete's history, calls this service, and persists the recommendation.
    | If the URL is empty the API answers 503 for prediction requests only —
    | everything else keeps working.
    */
    'url' => rtrim((string) env('ML_API_URL', ''), '/'),
    'token' => env('ML_API_TOKEN'),
    'timeout' => (int) env('ML_TIMEOUT', 12),
    'retry' => 2,

    'history_limit' => 300,
];
