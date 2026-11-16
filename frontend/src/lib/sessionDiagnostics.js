/**
 * Session diagnostics for cookie-blocked browsers.
 *
 * TRANA stores its session in an HttpOnly cookie. When the SPA and the API are
 * served from different origins (in production: `*.vercel.app` hosts, which are
 * separate *sites* because vercel.app is on the Public Suffix List), that
 * cookie is a third-party cookie. Brave blocks those by default, and Safari and
 * Firefox block them too.
 *
 * The failure is invisible without help: `GET /api/auth/me` answers 401 because
 * the cookie was never sent, which is byte-for-byte the same response as
 * "nobody is logged in". The user lands back on the marketing page with no
 * explanation and no way to know a shield icon is the culprit.
 *
 * `detectBlockedCookieStorage()` gives us positive evidence rather than a
 * guess: it writes a throwaway cookie and reads it straight back in the same
 * tick. If the browser stores it, storage works. If it does not, login is
 * impossible on this browser and the UI can say so.
 */

/** Same-name probe cookie prefix — never collides with `trana_session`. */
const PROBE_NAME = 'trana_probe';

/**
 * True when this browser refuses to store even a first-party cookie.
 *
 * A first-party probe is intentional: it is the strictest, most conservative
 * test. If the browser fails *this*, no configuration of SameSite can rescue
 * the session and the user needs a different browser. A browser that passes
 * the probe is cross-site capable, and the 401 is then something else.
 *
 * Synchronous on purpose — reading `document.cookie` in the same task as the
 * write means no other code can observe or clear the probe first.
 */
export function detectBlockedCookieStorage() {
  if (typeof document === 'undefined') return false;

  const value = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const name = `${PROBE_NAME}_${value}`;
  const attributes = '; path=/; SameSite=Lax';

  try {
    document.cookie = `${name}=1${attributes}`;
    const stored = document.cookie.includes(`${name}=`);
    // Always clean up, whichever way the result went. An epoch `expires` is
    // used rather than `max-age=0`: some cookie implementations (and the test
    // DOM) leave an empty cookie behind for max-age and only truly delete on
    // an expiry in the past.
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    return !stored;
  } catch {
    // An exception means the cookie jar is unreachable, which is the same
    // user-facing condition as a silently dropped write.
    return true;
  }
}

/**
 * Guidance tailored to the browser, because the toggle lives somewhere
 * different in each and the generic advice is useless.
 */
export function cookieBlockedGuidance(userAgent = '') {
  const ua = String(userAgent || '');

  if (/Brave/i.test(ua)) {
    return 'Your browser is blocking TRANA’s login cookie. Tap the orange lion icon in the address bar, then turn off “Block cross-site cookies” for this site and try again.';
  }
  if (/Edg\//.test(ua)) {
    return 'Your browser is blocking TRANA’s login cookie. Open Settings › Cookies and site permissions › Manage and delete cookies, allow cookies for this site, then try again.';
  }
  if (/Firefox|FxiOS/i.test(ua)) {
    return 'Your browser is blocking TRANA’s login cookie. Open the shield icon in the address bar and turn off Enhanced Tracking Protection for this site, then try again.';
  }
  if (/Safari/i.test(ua) && !/Chrome|CriOS|Edg/i.test(ua)) {
    return 'Safari is blocking TRANA’s login cookie. Open Settings › Safari and turn off “Prevent Cross-Site Tracking”, then try again.';
  }
  if (/Chrome|CriOS/i.test(ua)) {
    return 'Your browser is blocking TRANA’s login cookie. Open the padlock icon in the address bar › Cookies, allow them for this site, then try again.';
  }

  return 'Your browser is blocking TRANA’s login cookie. Allow cookies for this site, or open TRANA in another browser, then try again.';
}
