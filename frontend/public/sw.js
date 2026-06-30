// Service worker for Invisible Sales OS — push notifications
// NOTE: This file MUST remain plain JS (no imports, no TypeScript).
// Browser service workers run in their own isolated context.

self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Invisible Sales OS';
  const options = {
    body: data.body || 'New notification',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: data.url ? { url: data.url } : {},
    actions: data.actions || [],
    tag: data.tag || 'default',
    requireInteraction: data.requireInteraction || false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data?.url || '/app/dashboard';
  event.waitUntil(clients.openWindow(url));
});
