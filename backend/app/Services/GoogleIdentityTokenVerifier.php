<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/** Verifies Google Identity Services ID tokens against Google's rotating RSA keys. */
class GoogleIdentityTokenVerifier
{
    private const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

    private const CACHE_KEY = 'google.oauth.signing-keys';

    public function isConfigured(): bool
    {
        $clientId = config('services.google.client_id');

        return is_string($clientId) && trim($clientId) !== '';
    }

    /** @return array{sub: string, email: string, name: string, nonce: string} */
    public function verify(string $jwt): array
    {
        $clientId = config('services.google.client_id');
        if (! is_string($clientId) || trim($clientId) === '') {
            throw new RuntimeException('Google sign-in is not configured on the server.');
        }
        $clientId = trim($clientId);

        if (strlen($jwt) > 8192) {
            $this->invalidCredential();
        }

        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            $this->invalidCredential();
        }

        $header = $this->decodeJsonSegment($parts[0]);
        $claims = $this->decodeJsonSegment($parts[1]);
        $signature = $this->decodeBase64Url($parts[2]);

        if (! $header || ! $claims || $signature === null
            || ($header['alg'] ?? null) !== 'RS256'
            || array_key_exists('crit', $header)
            || (array_key_exists('b64', $header) && $header['b64'] !== true)
            || ! is_string($header['kid'] ?? null)
            || $header['kid'] === '') {
            $this->invalidCredential();
        }

        $jwk = $this->findSigningKey($header['kid']);
        if (! $jwk) {
            // A key may have rotated since the cached JWKS was fetched.
            $jwk = $this->findSigningKey($header['kid'], refresh: true);
        }
        if (! $jwk) {
            $this->invalidCredential();
        }

        $publicKey = openssl_pkey_get_public($this->jwkToPem($jwk));
        if ($publicKey === false
            || openssl_verify($parts[0].'.'.$parts[1], $signature, $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
            $this->invalidCredential();
        }

        $now = time();
        $audience = $claims['aud'] ?? null;
        $audienceValuesValid = is_string($audience)
            ? $audience !== ''
            : (is_array($audience) && $audience !== []
                && count(array_filter($audience, 'is_string')) === count($audience));
        $audienceMatches = $audienceValuesValid && (is_string($audience)
            ? hash_equals($clientId, $audience)
            : in_array($clientId, $audience, true));
        $issuer = $claims['iss'] ?? null;
        $verifiedEmailClaim = $claims['email_verified'] ?? false;
        $verifiedEmail = $verifiedEmailClaim === true || $verifiedEmailClaim === 'true';
        $emailClaim = $claims['email'] ?? null;
        $email = is_string($emailClaim) ? strtolower(trim($emailClaim)) : '';
        $subject = $claims['sub'] ?? null;
        $nonce = $claims['nonce'] ?? null;
        $issuedAt = $claims['iat'] ?? null;
        $expiresAt = $claims['exp'] ?? null;
        $authorizedParty = $claims['azp'] ?? null;
        $notBefore = $claims['nbf'] ?? null;

        $multipleAudiences = is_array($audience) && count($audience) > 1;
        $authorizedPartyValid = ! array_key_exists('azp', $claims)
            || (is_string($authorizedParty) && hash_equals($clientId, $authorizedParty));
        if ($multipleAudiences && ! is_string($authorizedParty)) {
            $authorizedPartyValid = false;
        }

        if (! $audienceMatches
            || ! $authorizedPartyValid
            || ! in_array($issuer, ['https://accounts.google.com', 'accounts.google.com'], true)
            || ! $verifiedEmail
            || strlen($email) > 255
            || ! filter_var($email, FILTER_VALIDATE_EMAIL)
            || ! is_string($subject) || $subject === '' || strlen($subject) > 255
            || ! is_string($nonce) || $nonce === '' || strlen($nonce) > 256
            || ! is_numeric($issuedAt) || (int) $issuedAt <= 0 || (int) $issuedAt > $now + 60
            || ! is_numeric($expiresAt) || (int) $expiresAt <= $now || (int) $expiresAt <= (int) $issuedAt
            || (int) $expiresAt - (int) $issuedAt > 3600 + 60
            || (array_key_exists('nbf', $claims) && (! is_numeric($notBefore) || (int) $notBefore > $now + 60))) {
            $this->invalidCredential();
        }

        $nameClaim = $claims['name'] ?? null;
        $name = is_string($nameClaim) ? trim($nameClaim) : '';
        if ($name === '') {
            $name = strstr($email, '@', true) ?: 'TRANA athlete';
        }

        return [
            'sub' => $subject,
            'email' => $email,
            'name' => mb_substr($name, 0, 80),
            'nonce' => $nonce,
        ];
    }

    /** @return array<string, mixed>|null */
    private function findSigningKey(string $kid, bool $refresh = false): ?array
    {
        if ($refresh) {
            Cache::forget(self::CACHE_KEY);
        }

        $keys = Cache::remember(self::CACHE_KEY, 3600, function (): array {
            try {
                $response = Http::acceptJson()->timeout(5)->get(self::CERTS_URL);
            } catch (\Throwable $exception) {
                throw new RuntimeException('Google signing keys are temporarily unavailable.', previous: $exception);
            }

            if (! $response->successful() || ! is_array($response->json('keys'))) {
                throw new RuntimeException('Google signing keys are temporarily unavailable.');
            }

            return $response->json('keys');
        });

        foreach ($keys as $key) {
            if (is_array($key) && ($key['kid'] ?? null) === $kid
                && ($key['kty'] ?? null) === 'RSA'
                && ($key['alg'] ?? 'RS256') === 'RS256'
                && ($key['use'] ?? 'sig') === 'sig') {
                return $key;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $jwk */
    private function jwkToPem(array $jwk): string
    {
        $modulus = $this->decodeBase64Url(is_string($jwk['n'] ?? null) ? $jwk['n'] : '');
        $exponent = $this->decodeBase64Url(is_string($jwk['e'] ?? null) ? $jwk['e'] : '');
        if ($modulus === null || $exponent === null || $modulus === '' || $exponent === '') {
            $this->invalidCredential();
        }

        $rsaPublicKey = $this->derSequence($this->derInteger($modulus).$this->derInteger($exponent));
        $rsaEncryptionAlgorithm = hex2bin('300d06092a864886f70d0101010500');
        if ($rsaEncryptionAlgorithm === false) {
            $this->invalidCredential();
        }
        $bitStringContents = "\0".$rsaPublicKey;
        $subjectPublicKeyInfo = $this->derSequence(
            $rsaEncryptionAlgorithm
                ."\x03".$this->derLength(strlen($bitStringContents)).$bitStringContents,
        );

        return "-----BEGIN PUBLIC KEY-----\n"
            .chunk_split(base64_encode($subjectPublicKeyInfo), 64, "\n")
            ."-----END PUBLIC KEY-----\n";
    }

    private function decodeJsonSegment(string $segment): ?array
    {
        $decoded = $this->decodeBase64Url($segment);
        if ($decoded === null) {
            return null;
        }

        try {
            $value = json_decode($decoded, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return is_array($value) ? $value : null;
    }

    private function decodeBase64Url(string $value): ?string
    {
        if ($value === '' || preg_match('/^[A-Za-z0-9_-]+$/', $value) !== 1) {
            return null;
        }

        $padding = (4 - strlen($value) % 4) % 4;
        $decoded = base64_decode(strtr($value, '-_', '+/').str_repeat('=', $padding), true);

        return $decoded === false ? null : $decoded;
    }

    private function derInteger(string $integer): string
    {
        $integer = ltrim($integer, "\0");
        if ($integer === '' || (ord($integer[0]) & 0x80) !== 0) {
            $integer = "\0".$integer;
        }

        return "\x02".$this->derLength(strlen($integer)).$integer;
    }

    private function derSequence(string $contents): string
    {
        return "\x30".$this->derLength(strlen($contents)).$contents;
    }

    private function derLength(int $length): string
    {
        if ($length < 0x80) {
            return chr($length);
        }

        $bytes = ltrim(pack('N', $length), "\0");

        return chr(0x80 | strlen($bytes)).$bytes;
    }

    private function invalidCredential(): never
    {
        throw ValidationException::withMessages([
            'credential' => ['Google sign-in could not be verified. Please try again.'],
        ]);
    }
}
