/**
 * lib/formLeadCore.js — Pure orchestration core for the generic form webhook.
 *
 * Deliberately imports NOTHING heavy (no engine, no Supabase, no googleapis).
 * All collaborators arrive via `deps`, so this is fully unit-testable in
 * isolation and keeps the import graph light for the test runner.
 * The Express wiring + real dependency implementations live in
 * controllers/leadWebhook.js.
 */

/**
 * @param {Object} args
 * @param {Object} args.body
 * @param {Object} [args.headers]
 * @param {string} [args.ip]
 * @param {Object} args.deps
 * @param {Object} args.deps.rateLimiter      — { check(key) => { allowed, retryAfterMs } }
 * @param {Object} args.deps.schema           — Zod schema with safeParse
 * @param {Function} args.deps.resolveTenantId   — async () => tenantId, derived server-side.
 *   Never trust a caller-supplied tenant identity here — there is no JWT/session
 *   on this route, so `x-tenant-id` (or any other request field) cannot be
 *   authenticated. See Block 1.2.
 * @param {Function} args.deps.upsertContact     — async ({tenantId,data}) => { id }
 * @param {Function} args.deps.runEngine         — async ({tenantId,data}) => engineResult
 * @param {Function} args.deps.linkLeadContact   — async (leadId, contactId, tenantId) => void
 * @param {string|null} [args.deps.secret]
 * @returns {Promise<{status:number, body:object}>}
 */
export async function processFormLead({ body = {}, headers = {}, ip = 'unknown', deps }) {
  const {
    rateLimiter,
    schema,
    resolveTenantId,
    upsertContact,
    runEngine,
    linkLeadContact,
    secret = null,
  } = deps;

  // 1. Shared-secret gate (only enforced when a secret is configured).
  if (secret) {
    if (headers['x-webhook-secret'] !== secret) {
      return { status: 401, body: { success: false, error: 'Invalid or missing webhook secret' } };
    }
  }

  // 2. Rate limit (per IP).
  const rl = rateLimiter.check(ip);
  if (!rl.allowed) {
    return { status: 429, body: { success: false, error: 'Rate limit exceeded', retry_after_ms: rl.retryAfterMs } };
  }

  // 3. Validate.
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        success: false,
        error: 'Validation failed',
        issues: parsed.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
      },
    };
  }
  const data = parsed.data;

  // 4. Resolve tenant server-side. An unauthenticated webhook caller has no way
  // to assert its own tenant identity, so `x-tenant-id` is never read here.
  let tenantId;
  try {
    tenantId = await resolveTenantId();
  } catch (err) {
    console.error('🚨 [FormWebhook]: tenant resolution failed —', err.message);
    return { status: 502, body: { success: false, error: 'Lead accepted but processing failed', contactId: null } };
  }

  // 5. Upsert the contact (non-fatal — lead still proceeds if this fails).
  let contact = null;
  try {
    contact = await upsertContact({ tenantId, data });
  } catch (err) {
    console.error('⚠️ [FormWebhook]: contact upsert failed —', err.message);
  }

  // 6. Run the cognitive engine (triage → draft → auto-reply gate).
  let engineResult = null;
  try {
    engineResult = await runEngine({ tenantId, data });
  } catch (err) {
    console.error('🚨 [FormWebhook]: engine failure —', err.message);
    return { status: 502, body: { success: false, error: 'Lead accepted but processing failed', contactId: contact?.id ?? null } };
  }

  // 7. Link the created lead to the contact.
  if (engineResult?.leadId && contact?.id) {
    try {
      await linkLeadContact(engineResult.leadId, contact.id, tenantId);
    } catch (err) {
      console.error('⚠️ [FormWebhook]: failed to link lead↔contact —', err.message);
    }
  }

  // 8. Telemetry response.
  return {
    status: engineResult?.success ? 202 : 200,
    body: {
      success: true,
      trackingId: engineResult?.leadId ?? null,
      contactId: contact?.id ?? null,
      classification: engineResult?.profile?.priority ?? null,
      autoReply: engineResult?.autoReply?.action ?? null,
      delivery: engineResult?.deliveryStatus ?? null,
    },
  };
}
