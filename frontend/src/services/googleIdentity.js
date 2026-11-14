import { resolveGoogleClientId } from './config.js';

export const GOOGLE_CLIENT_ID = resolveGoogleClientId(import.meta.env);

let googleScriptPromise;

/** Load Google's official Identity Services script once for the auth page. */
export function loadGoogleIdentity() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google sign-in is only available in a browser.'));
  }

  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.tranaGoogleIdentity = 'true';
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google);
      else reject(new Error('Google sign-in did not finish loading.'));
    };
    script.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection and try again.'));
    document.head.appendChild(script);
  }).catch((error) => {
    googleScriptPromise = null;
    document.querySelector('script[data-trana-google-identity]')?.remove();
    throw error;
  });

  return googleScriptPromise;
}
