<?php

namespace Tests\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

trait GoogleAuthTestHelpers
{
    private static ?string $googleTestPrivateKey = null;

    private static ?array $googleTestJwk = null;

    protected function prepareGoogleAuth(): void
    {
        config(['services.google.client_id' => 'trana-test-google-client-id']);
        $this->ensureGoogleTestKey();
        Cache::forget('google.oauth.signing-keys');

        Http::fake([
            'https://www.googleapis.com/oauth2/v3/certs' => Http::response([
                'keys' => [self::$googleTestJwk],
            ], 200),
        ]);
    }

    protected function requestGoogleNonce(array $headers = []): string
    {
        $response = $this->postJson('/api/auth/google/nonce', [], $headers)->assertOk();
        $nonce = $response->json('nonce');
        if (! is_string($nonce) || $nonce === '') {
            throw new RuntimeException('The Google nonce endpoint returned no nonce.');
        }

        return $nonce;
    }

    /** @param array<string, mixed> $overrides */
    protected function googleCredential(string $nonce, array $overrides = []): string
    {
        $this->ensureGoogleTestKey();
        $now = time();
        $claims = array_replace([
            'iss' => 'https://accounts.google.com',
            'aud' => 'trana-test-google-client-id',
            'iat' => $now,
            'exp' => $now + 3600,
            'sub' => 'google-subject-123',
            'email' => 'athlete@example.com',
            'email_verified' => true,
            'name' => 'Google Athlete',
            'nonce' => $nonce,
        ], $overrides);
        $header = ['alg' => 'RS256', 'typ' => 'JWT', 'kid' => 'trana-test-signing-key'];
        $signingInput = $this->base64Url(json_encode($header, JSON_THROW_ON_ERROR))
            .'.'.$this->base64Url(json_encode($claims, JSON_THROW_ON_ERROR));
        if (! openssl_sign($signingInput, $signature, self::$googleTestPrivateKey, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('Could not sign the Google auth test fixture.');
        }

        return $signingInput.'.'.$this->base64Url($signature);
    }

    /** @return array<string, mixed> */
    protected function signInWithGoogle(array $claims = [], array $headers = []): array
    {
        $nonce = $this->requestGoogleNonce($headers);
        $claims['nonce'] = $nonce;

        return $this->postJson('/api/auth/google', [
            'credential' => $this->googleCredential($nonce, $claims),
        ], $headers)->assertOk()->json();
    }

    /** @return array<string, mixed> */
    protected function createGoogleAccount(string $name, string $email): array
    {
        return $this->signInWithGoogle([
            'sub' => 'trana-test-'.$email,
            'email' => $email,
            'name' => $name,
        ]);
    }

    /** @return array<string, mixed> */
    protected function signInToGoogleAccount(string $email, string $name = 'Google Athlete'): array
    {
        return $this->signInWithGoogle([
            'sub' => 'trana-test-'.$email,
            'email' => $email,
            'name' => $name,
        ]);
    }

    private function ensureGoogleTestKey(): void
    {
        if (self::$googleTestPrivateKey !== null && self::$googleTestJwk !== null) {
            return;
        }

        $privateKey = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
            'private_key_bits' => 2048,
        ]);
        $privateKeyPem = '';
        if ($privateKey === false || ! openssl_pkey_export($privateKey, $privateKeyPem)) {
            throw new RuntimeException('Could not create an RSA key for Google auth tests.');
        }
        self::$googleTestPrivateKey = $privateKeyPem;

        $details = openssl_pkey_get_details($privateKey);
        if (! is_array($details) || ! is_array($details['rsa'] ?? null)) {
            throw new RuntimeException('Could not read the Google auth test RSA key.');
        }

        self::$googleTestJwk = [
            'kid' => 'trana-test-signing-key',
            'kty' => 'RSA',
            'alg' => 'RS256',
            'use' => 'sig',
            'n' => $this->base64Url($details['rsa']['n']),
            'e' => $this->base64Url($details['rsa']['e']),
        ];
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
