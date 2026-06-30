/**
 * pushNotify.js — Backend web push sender.
 * Uses the `web-push` package to dispatch notifications
 * to all subscribed devices for a given tenant.
 *
 * Import and call sendPushToTenant() from server.js after a HIGH lead is saved.
 */

import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Sends a push notification to all subscribed devices for a tenant.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} tenantId
 * @param {{ title: string, body: string, url?: string, tag?: string, requireInteraction?: boolean }} payload
 */
export async function sendPushToTenant(supabase, tenantId, payload) {
  // Fetch all active push subscriptions for this tenant
  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[Push]: Failed to fetch subscriptions:', error.message);
    return;
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log('[Push]: No subscriptions found for tenant', tenantId);
    return;
  }

  console.log(`[Push]: Sending to ${subscriptions.length} device(s) for tenant ${tenantId}`);

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
        console.log(`[Push]: ✅ Delivered to ${sub.endpoint.slice(0, 60)}...`);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription has expired or is no longer valid — clean it up
          console.log(`[Push]: ♻️  Subscription expired (${err.statusCode}) — removing from DB.`);
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('id', sub.id);
        } else {
          console.warn(`[Push]: ⚠️  Failed to send (${err.statusCode}): ${err.message}`);
        }
        throw err; // re-throw so Promise.allSettled records it as rejected
      }
    })
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  console.log(`[Push]: Done — ${succeeded} delivered, ${failed} failed.`);
}
