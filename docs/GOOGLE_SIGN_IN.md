# Google sign-in setup

TRANA implements Google OAuth as a server-side authorization-code flow with
PKCE and a short-lived state cookie. The API retrieves the Google profile over
HTTPS and accepts the account only when Google reports `email_verified: true`.
The resulting TRANA session uses the same HttpOnly cookie as password login.
Google sign-in does **not** issue or require a TRANA email code; password
registration, password login, and their existing email-verification behavior
remain unchanged.

## 1. Create a Google OAuth web client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or
   create the project that will own TRANA's OAuth consent screen.
2. Configure the consent screen / Google Auth Platform branding and audience.
   Add a support email and the app details Google requests. For initial testing,
   keep the app in **Testing** and add the Google accounts that may sign in as
   test users. Move to production only after reviewing Google's verification
   requirements for the app and its domains.
3. Create an OAuth client with application type **Web application**.
4. Add the callback as an **Authorized redirect URI**. It must use the
   **frontend** origin, not the API origin:

   ```text
   https://trana-web.vercel.app/api/auth/google/callback
   ```

   `frontend/vercel.json` proxies `/api/*` to the API, but Google validates the
   URI string *before* the browser sends the request — it never sees the
   rewrite. Registering the API origin instead means the OAuth state cookie is
   written on one host and read on another, so every sign-in lands on
   `?google=failed`. For local development the matching URI is
   `http://localhost:8001/api/auth/google/callback`. Redirect URIs must match
   exactly; do not add a wildcard. This is a server-side flow, so a JavaScript
   origin is not used by the app.

   Keep the old `https://trana-api.vercel.app/api/auth/google/callback` entry
   registered during a migration — it costs nothing and allows an instant
   rollback.
5. The requested OpenID Connect scopes are `openid`, `email`, and `profile`.
   Do not add broader scopes for this sign-in feature.
6. Copy the generated **Client ID** and **Client secret** for entry into Vercel.
   Keep the secret private. Never put it in frontend variables, source control,
   an issue, or chat.

Google may require domain ownership verification for production branding. If
Google Cloud requires an owned domain, use a TRANA domain you control for the
frontend/API and callback rather than trying to claim the shared `vercel.app`
domain.

## 2. Add variables to the Laravel API on Vercel

In Vercel, open the **`trana-api` project → Settings → Environment Variables**.
Add these to the environments where Google sign-in should work (usually
Production first; add Preview only if you deliberately configure preview OAuth):

| Variable | Production value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | The Client ID from the Google web application client |
| `GOOGLE_CLIENT_SECRET` | The matching Client secret; enter it directly in Vercel as a secret |
| `GOOGLE_REDIRECT_URI` | `https://trana-web.vercel.app/api/auth/google/callback` |
| `FRONTEND_URL` | The browser-facing frontend origin, e.g. `https://trana-web.vercel.app` |

Use the **same exact** `GOOGLE_REDIRECT_URI` in Google Cloud and Vercel. If you
use a custom API domain, update both. `FRONTEND_URL` is where the API returns
the browser after authentication; it must be the SPA origin, not the API origin.
The redirect URI defaults locally to `${APP_URL}/api/auth/google/callback`, but
set it explicitly in each hosted Vercel environment.

The existing API settings still apply:

- `APP_KEY` must be stable and set so the API can protect OAuth state.
- `CORS_ALLOWED_ORIGINS` must contain the exact frontend origin(s).
- Keep the HTTPS cookie setup as `TRANA_COOKIE_SAME_SITE=lax`. The SPA and the
  API share one origin through the `/api` proxy, so every TRANA cookie —
  including the OAuth state cookie — is first-party. This is what lets Brave,
  Safari and Firefox sign in at all: each blocks third-party cookies by
  default, and `SameSite=None` only opts further into that blocking. `none` is
  required only if the frontend and API are ever served from different sites
  again, and it does not work in those browsers.
- `VITE_API_BASE_URL` stays on the frontend project and points to the API. Do
  not prefix Google credentials with `VITE_` or add them to the frontend.
- Ensure the `google_sub` migration has been applied to the API database before
  enabling sign-in.

Saving environment variables does not change a running deployment. Once the
values and Google redirect URI have been reviewed, redeploy the API through the
normal Vercel release process. No secrets need to be shared with TRANA support.

## 3. Verify the setup

1. Visit the deployed TRANA login page and choose **Continue with Google**.
2. Complete the Google account selection/consent flow.
3. Confirm that TRANA returns to the frontend, creates the session, and shows
   onboarding or the signed-in app. No TRANA code should be sent for this flow.
4. Test an existing password account whose email matches the Google-verified
   address: the account should be linked to that Google identity, its existing
   password should remain intact, and its email should become verified. A
   conflicting identity or suspended account must not receive a session.
5. Separately confirm that password registration still sends its usual TRANA
   verification code and unverified password login still requires that code.

A `?google=failed` result while password login works usually means the state
cookie never came back: confirm the API is deployed with the cross-site cookie
policy above, keep API and frontend on HTTPS, and retry in a fresh tab. If Google
returns `redirect_uri_mismatch`, compare the URI in the Google client
and Vercel character-for-character, then check that the API was redeployed. For
`access_denied`, check the OAuth consent-screen audience and test-user list. If
authentication succeeds at Google but TRANA shows a generic failure, inspect the
API's Vercel runtime logs without recording OAuth tokens, codes, cookies, or
client secrets.
