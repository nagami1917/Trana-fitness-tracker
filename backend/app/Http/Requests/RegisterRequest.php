<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Store emails canonically lowercase so the Gmail gate, the unique
     * check (Postgres unique is case-sensitive) and later logins all see
     * the same address regardless of how the user typed it.
     */
    protected function prepareForValidation(): void
    {
        $email = $this->input('email');
        if (is_string($email)) {
            $this->merge(['email' => strtolower(trim($email))]);
        }
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80'],
            'email' => [
                'required',
                'email',
                'max:255',
                'unique:users,email',
                // Sign-up is limited to Gmail addresses (case-insensitive,
                // exact '@gmail.com' suffix — 'x@gmail.com.evil' and
                // 'x@notgmail.com' both fail). Existing non-Gmail accounts
                // can still log in; this only gates NEW registrations.
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! is_string($value) || ! str_ends_with(strtolower($value), '@gmail.com')) {
                        $fail('Sign-up is limited to Gmail addresses — please use your @gmail.com address.');
                    }
                },
            ],
            'password' => ['required', 'string', Password::min(8)->letters()->numbers()],
        ];
    }
}
