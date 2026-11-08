<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Thin HTTP client for the Python FastAPI prediction service.
 *
 * Laravel never contains the model itself: it assembles the athlete's history,
 * asks the ML service for a prediction, and persists the result. Keeping this
 * in one place means the model can be retrained and redeployed without
 * touching the API layer.
 */
class MlClient
{
    public function configured(): bool
    {
        return (string) config('ml.url') !== '';
    }

    public function predict(array $payload): array
    {
        $response = $this->request()->post('/predict', $payload);

        if ($response->failed()) {
            throw new RuntimeException(
                'The prediction service is unavailable right now (HTTP '.$response->status().').'
            );
        }

        return $response->json();
    }

    public function duration(array $payload): array
    {
        $response = $this->request()->post('/predict/duration', $payload);

        if ($response->failed()) {
            throw new RuntimeException('The duration model could not be reached.');
        }

        return $response->json();
    }

    public function modelInfo(): array
    {
        if (! $this->configured()) {
            return ['status' => 'not_configured'];
        }

        $response = $this->request()->get('/model/info');

        return $response->successful() ? $response->json() : ['status' => 'unavailable'];
    }

    /** Ask the service to reload freshly trained artifacts into memory. */
    public function reload(): array
    {
        $request = $this->request();

        if ($token = env('ML_ADMIN_TOKEN')) {
            $request = $request->withHeaders(['X-Admin-Token' => $token]);
        }

        $response = $request->post('/model/reload');

        return $response->successful() ? $response->json() : ['reloaded' => false];
    }

    public function health(): array
    {
        if (! $this->configured()) {
            return ['status' => 'not_configured'];
        }

        $response = $this->request()->get('/health');

        return $response->successful() ? $response->json() : ['status' => 'unavailable'];
    }

    private function request(): PendingRequest
    {
        if (! $this->configured()) {
            throw new RuntimeException('ML_API_URL is not configured.');
        }

        $request = Http::baseUrl((string) config('ml.url'))
            ->acceptJson()
            ->asJson()
            ->timeout((int) config('ml.timeout', 12))
            ->retry((int) config('ml.retry', 2), 200);

        if ($token = config('ml.token')) {
            $request = $request->withToken($token);
        }

        return $request;
    }
}
