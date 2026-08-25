/**
 * tests/emailListener.test.js
 *
 * fetchUnreadEmails() (lib/emailListener.js) against a mocked `imapflow`
 * client. Covers the 2026-08-25 duplicate-invoice bug: a real E2E test
 * against a live Gmail inbox appended one email and got two invoice
 * records (INV-0007, INV-0008) out of it — root-caused to
 * client.messageFlagsAdd() resolving `false` on a silently-caught STORE
 * failure (imapflow's own store.js catches connection.exec()'s rejection
 * and returns false instead of throwing) while fetchUnreadEmails() ignored
 * that return value, so the still-unseen message got returned to the
 * caller as a normal successful fetch and was picked up again — and
 * re-delivered to onEmail() — on the very next poll.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  connect: vi.fn(),
  getMailboxLock: vi.fn(),
  search: vi.fn(),
  fetch: vi.fn(),
  messageFlagsAdd: vi.fn(),
  logout: vi.fn(),
};

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn(() => mockClient),
}));

const { fetchUnreadEmails } = await import('../lib/emailListener.js');

const CREDS = { host: 'imap.gmail.com', port: 993, user: 'a@example.com', pass: 'secret' };

function fakeMessage(uid) {
  return {
    uid,
    flags: new Set(),
    source: Buffer.from('Content-Type: text/plain\r\n\r\nHello\r\n'),
    envelope: {
      subject: 'INVOICE-E2E-TEST',
      date: new Date('2026-08-25T00:00:00Z'),
      from: [{ name: 'Vendor', address: 'vendor@example.com' }],
    },
  };
}

async function* asyncIterableOf(items) {
  for (const item of items) yield item;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.getMailboxLock.mockResolvedValue({ release: vi.fn() });
  mockClient.connect.mockResolvedValue(undefined);
  mockClient.logout.mockResolvedValue(undefined);
});

describe('fetchUnreadEmails — mark-as-seen failure', () => {
  it('throws (does not silently return the message) when messageFlagsAdd resolves false', async () => {
    mockClient.search.mockResolvedValue([681]);
    mockClient.fetch.mockReturnValue(asyncIterableOf([fakeMessage(681)]));
    // imapflow's store.js catches a failed STORE internally and resolves
    // `false` rather than rejecting — see commands/store.js's own JSDoc.
    mockClient.messageFlagsAdd.mockResolvedValue(false);

    await expect(fetchUnreadEmails(CREDS)).rejects.toThrow(/Failed to mark.*681/);

    // Logout still happens (the catch-and-rethrow cleanup path).
    expect(mockClient.logout).toHaveBeenCalled();
  });

  it('returns the message normally when messageFlagsAdd resolves true', async () => {
    mockClient.search.mockResolvedValue([681]);
    mockClient.fetch.mockReturnValue(asyncIterableOf([fakeMessage(681)]));
    mockClient.messageFlagsAdd.mockResolvedValue(true);

    const emails = await fetchUnreadEmails(CREDS);

    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe('INVOICE-E2E-TEST');
    expect(mockClient.messageFlagsAdd).toHaveBeenCalledWith([681], ['\\Seen'], { uid: true });
  });

  it('does not call messageFlagsAdd when there are no unseen messages', async () => {
    mockClient.search.mockResolvedValue([]);

    const emails = await fetchUnreadEmails(CREDS);

    expect(emails).toEqual([]);
    expect(mockClient.messageFlagsAdd).not.toHaveBeenCalled();
  });
});
