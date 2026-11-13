/**
 * PWA Web Push & Browser Fueling Reminder helpers.
 */

export function notificationSupport() {
  if (typeof window === 'undefined') return { supported: false, permission: 'unsupported', hasServiceWorker: false };
  const supported = 'Notification' in window;
  return {
    supported,
    permission: supported ? Notification.permission : 'unsupported',
    hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  };
}

export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

/**
 * Attempt to register a Web Push subscription (when VAPID public key is set),
 * or return a deterministic local browser endpoint identifier so reminder
 * preferences persist server-side and fire local PWA notifications.
 */
export async function buildPushSubscriptionPayload() {
  const support = notificationSupport();
  if (!support.supported) {
    throw new Error('Browser notifications are not supported on this device.');
  }
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was declined in browser settings.');
  }

  const vapidKey = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_VAPID_PUBLIC_KEY : '';
  if (support.hasServiceWorker && vapidKey) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing || (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      }));
      const json = sub.toJSON();
      return {
        endpoint: json.endpoint,
        public_key: json.keys?.p256dh ?? null,
        auth_token: json.keys?.auth ?? null,
      };
    } catch {
      // Fall through to local browser endpoint
    }
  }

  return {
    endpoint: `trana-local://${typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 40) : 'browser'}`,
    public_key: null,
    auth_token: null,
  };
}

export async function showLocalFuelingNotification({
  title = 'TRANA Fueling Reminder',
  body = 'Pre-session meal window: target ~72 g carbs 3 hours before your workout.',
} = {}) {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'trana-fuel-reminder',
        });
        return true;
      }
    } catch {
      // Fallback to window Notification below
    }
  }

  new Notification(title, { body, icon: '/icon-192.png' });
  return true;
}
