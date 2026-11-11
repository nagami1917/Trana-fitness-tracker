<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\HttpClientException;
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
 *
 * Failure contract: predict() and duration() throw RuntimeException whenever
 * the ML service is unusable (network error or non-2xx after retries), so
 * callers can answer 503. health()/modelInfo()/reload() never throw — they
 * return an "unavailable" payload instead.
 */
class MlClient
{
    public function configured(): bool
    {
        return (string) config('ml.url') !== '';
    }

    public function predict(array $payload): array
    {
        try {
            $response = $this->request()->post('/predict', $payload);
        } catch (ConnectionException $e) {
            throw new RuntimeException(
                'The prediction service is unreachable. Check the backend ML settings.',
                previous: $e
            );
        }

        if ($response->failed()) {
            throw new RuntimeException(
                'The prediction service is unavailable right now (HTTP '.$response->status().').'
            );
        }

        return $response->json();
    }

    public function duration(array $payload): array
    {
        try {
            $response = $this->request()->post('/predict/duration', $payload);
        } catch (ConnectionException $e) {
            throw new RuntimeException('The duration model could not be reached.', previous: $e);
        }

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

        try {
            $response = $this->request()->get('/model/info');
        } catch (\Throwable $e) {
            return ['status' => 'unavailable'];
        }

        return $response->successful() ? $response->json() : ['status' => 'unavailable'];
    }

    /** Ask the service to reload freshly trained artifacts into memory. */
    public function reload(): array
    {
        $request = $this->request();

        if ($token = config('ml.admin_token')) {
            $request = $request->withHeaders(['X-Admin-Token' => $token]);
        }

        try {
            $response = $request->post('/model/reload');
        } catch (\Throwable $e) {
            return ['reloaded' => false];
        }

        return $response->successful() ? $response->json() : ['reloaded' => false];
    }

    /**
     * Liveness probe for the prediction service.
     *
     * Never throws and never retries: it is called from the public health
     * endpoint, so a dead ML service must not turn into a slow or failed
     * request. The status tells the client whether saving a plan can work
     * ('ok' / 'not_configured' / 'unavailable').
     */
    public function health(): array
    {
        if (! $this->configured()) {
            return ['status' => 'not_configured'];
        }

        try {
            $response = $this->request(timeout: 3, retries: 0)->get('/health');
        } catch (\Throwable $e) {
            return ['status' => 'unavailable'];
        }

        if (! $response->successful()) {
            return ['status' => 'unavailable'];
        }

        $payload = $response->json();

        return is_array($payload) ? $payload : ['status' => 'ok'];
    }

    private function request(?int $timeout = null, ?int $retries = null): PendingRequest
    {
        if (! $this->configured()) {
            throw new RuntimeException('ML_API_URL is not configured.');
        }

        // NOTE: retry(..., throw: false) is deliberate. With the default
        // (throw: true), an HTTP 5xx after the final attempt throws
        // Illuminate\Http\Client\RequestException — which does NOT extend
        // RuntimeException — escaping the caller's error handling entirely.
        // We want the failed response back so predict() can raise a clean
        // RuntimeException and the controller can answer 503.
        $request = Http::baseUrl((string) config('ml.url'))
            ->acceptJson()
            ->asJson()
            ->timeout($timeout ?? (int) config('ml.timeout', 12))
            ->retry($retries ?? (int) config('ml.retry', 2), 200, throw: false);

        if ($token = config('ml.token')) {
            $request = $request->withToken($token);
        }

        return $request;
    }
}
