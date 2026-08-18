/**
 * controllers/digest.js — HTTP handlers for the weekly digest feature.
 *
 * Routes (registered in server.js):
 *   GET  /api/digest/preview      — generate stats for DEFAULT_TENANT_ID (no email sent)
 *   POST /api/digest/send-preview — generate + send to the tenant owner's email immediately
 *
 * Both routes are protected by requireInternalKey middleware.
 */

import { generateWeeklyDigest, sendWeeklyDigest } from '../lib/weeklyDigest.js';
import { supabase } from '../lib/supabase.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

/**
 * GET /api/digest/preview
 * Returns the digest stats and subject for the default tenant.
 * Does NOT return the full HTML (too large for JSON).
 *
 * tenant_id is intentionally NOT read from req.query — this route sits
 * behind requireInternalKey only (no user session), and the frontend's
 * unauthenticated /app/digest-preview proxy auto-attaches that internal key
 * for any visitor regardless of login state. A caller-supplied tenant_id
 * here previously let anyone generate another tenant's digest preview.
 */
export async function getDigestPreview(req, res) {
  try {
    const tenantId = DEFAULT_TENANT_ID;
    const { subject, html, stats } = await generateWeeklyDigest(supabase, tenantId);

    return res.json({
      success: true,
      subject,
      stats,
      html_length: html.length,
    });
  } catch (err) {
    console.error(`❌ [Digest Controller]: getDigestPreview failed — ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/digest/send-preview
 * Generates the digest and sends it immediately to the tenant owner's email.
 *
 * tenant_id and to_email are intentionally NOT read from req.body — this
 * route sits behind requireInternalKey only, and (per the same reasoning as
 * getDigestPreview above) that key gets auto-attached for any unauthenticated
 * visitor by the frontend's proxy. A caller-supplied tenant_id + to_email
 * previously let anyone trigger a real send, for any tenant, to any address
 * they chose. This always sends to the resolved tenant's own registered
 * owner_email now.
 */
export async function sendDigestPreview(req, res) {
  try {
    const tenantId = DEFAULT_TENANT_ID;

    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('owner_email, name')
      .eq('id', tenantId)
      .single();

    if (tenantErr || !tenant?.owner_email) {
      return res.status(400).json({
        success: false,
        error: 'No owner_email found for this tenant.',
      });
    }
    const toEmail = tenant.owner_email;

    const result = await sendWeeklyDigest(supabase, tenantId, toEmail);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      email_sent_to: toEmail,
      stats: result.stats,
    });
  } catch (err) {
    console.error(`❌ [Digest Controller]: sendDigestPreview failed — ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
}
