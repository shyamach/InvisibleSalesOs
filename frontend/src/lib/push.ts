/**
 * push.ts — Browser-side push subscription helpers.
 * Handles service worker registration, permission requests,
 * and subscribe/unsubscribe API calls.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

/**
 * Converts a base64url VAPID public key to a Uint8Array
 * as required by pushManager.subscribe().
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Returns true if the current browser supports push notifications.
 * Safe to call during SSR (returns false on server).
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * Registers the service worker, requests notification permission,
 * subscribes to push, and saves the subscription to the backend.
 *
 * @returns true on success, false if permission was denied or unsupported
 */
export async function registerPushSubscription(tenantId: string): Promise<boolean> {
  if (!isPushSupported()) {
    console.warn('[Push]: Push notifications not supported in this browser.');
    return false;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.warn('[Push]: NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set.');
    return false;
  }

  // Register (or retrieve existing) service worker
  const reg = await navigator.serviceWorker.register('/sw.js');

  // Request notification permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('[Push]: Notification permission denied.');
    return false;
  }

  // Subscribe to push — reuses existing subscription if already subscribed
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
  });

  const json = subscription.toJSON();
  const keys = json.keys as { p256dh: string; auth: string };

  // Save subscription to backend
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      tenant_id: tenantId,
    }),
  });

  if (!res.ok) {
    console.warn('[Push]: Failed to save subscription to server:', await res.text());
    return false;
  }

  console.log('[Push]: Subscription registered successfully.');
  return true;
}

/**
 * Unsubscribes the current device from push notifications
 * and removes it from the backend.
 */
export async function unregisterPushSubscription(): Promise<void> {
  if (!isPushSupported()) return;

  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  if (!reg) return;

  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });

  console.log('[Push]: Unsubscribed successfully.');
}
