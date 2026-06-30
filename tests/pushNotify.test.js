/**
 * tests/pushNotify.test.js
 * Unit tests for lib/pushNotify.js
 * web-push and supabase are fully mocked — no real push calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock web-push ────────────────────────────────────────────────────────────
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

import webpush from 'web-push';
import { sendPushToTenant } from '../lib/pushNotify.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const MOCK_PAYLOAD = {
  title: '🔴 HIGH Priority Lead',
  body: 'Test Contact — Test Product',
  url: '/app/drafts',
  tag: 'high-lead',
  requireInteraction: true,
};

function makeSubscription(overrides = {}) {
  return {
    id: 'sub-1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtZ',
    auth: 'tBHItJI5svbpez7KI4CCXg',
    ...overrides,
  };
}

function makeSupabaseMock(subscriptions) {
  const deleteMock = {
    eq: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: subscriptions, error: null }),
      }),
      delete: vi.fn().mockReturnValue(deleteMock),
    }),
    _deleteMock: deleteMock,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sendPushToTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips gracefully when no subscriptions are found', async () => {
    const supabase = makeSupabaseMock([]);

    await sendPushToTenant(supabase, TENANT_ID, MOCK_PAYLOAD);

    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('calls webpush.sendNotification for each subscription', async () => {
    const subs = [
      makeSubscription({ id: 'sub-1', endpoint: 'https://fcm.test/ep1' }),
      makeSubscription({ id: 'sub-2', endpoint: 'https://fcm.test/ep2' }),
    ];
    const supabase = makeSupabaseMock(subs);

    webpush.sendNotification.mockResolvedValue({ statusCode: 201 });

    await sendPushToTenant(supabase, TENANT_ID, MOCK_PAYLOAD);

    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);

    // Verify the first call used the correct subscription shape
    const firstCallArg = webpush.sendNotification.mock.calls[0][0];
    expect(firstCallArg.endpoint).toBe('https://fcm.test/ep1');
    expect(firstCallArg.keys.p256dh).toBe(subs[0].p256dh);
    expect(firstCallArg.keys.auth).toBe(subs[0].auth);

    // Verify the payload was stringified
    const sentPayload = JSON.parse(webpush.sendNotification.mock.calls[0][1]);
    expect(sentPayload.title).toBe(MOCK_PAYLOAD.title);
    expect(sentPayload.requireInteraction).toBe(true);
  });

  it('deletes expired subscriptions that return a 410 Gone error', async () => {
    const expiredSub = makeSubscription({ id: 'sub-expired' });
    const supabase = makeSupabaseMock([expiredSub]);

    const expiredError = Object.assign(new Error('Gone'), { statusCode: 410 });
    webpush.sendNotification.mockRejectedValue(expiredError);

    await sendPushToTenant(supabase, TENANT_ID, MOCK_PAYLOAD);

    // Should have attempted to delete the expired subscription
    expect(supabase.from).toHaveBeenCalledWith('push_subscriptions');
    // The delete chain should have been invoked with the expired sub's id
    expect(supabase._deleteMock.eq).toHaveBeenCalledWith('id', 'sub-expired');
  });
});
