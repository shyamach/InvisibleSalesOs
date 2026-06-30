/**
 * lib/weeklyDigest.js — Weekly digest email generator.
 *
 * Collects a week's worth of sales stats per tenant and generates a rich HTML email.
 * Uses Claude Haiku for the AI narrative section.
 *
 * Requires in .env.local:
 *   ANTHROPIC_API_KEY  — for the AI narrative
 *   RESEND_API_KEY     — via emailSend.js
 *   RESEND_FROM_EMAIL  — via emailSend.js
 */

import Anthropic from '@anthropic-ai/sdk';
import { sendEmailReply } from './emailSend.js';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getWeekRange() {
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setUTCHours(23, 59, 59, 999);

  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - 6);
  weekStart.setUTCHours(0, 0, 0, 0);

  const prevWeekEnd = new Date(weekStart);
  prevWeekEnd.setUTCMilliseconds(-1);

  const prevWeekStart = new Date(prevWeekEnd);
  prevWeekStart.setUTCDate(prevWeekEnd.getUTCDate() - 6);
  prevWeekStart.setUTCHours(0, 0, 0, 0);

  return { weekStart, weekEnd, prevWeekStart, prevWeekEnd };
}

export function formatDateRange(startIso, endIso) {
  const opts = { day: 'numeric', month: 'short' };
  const start = new Date(startIso).toLocaleDateString('en-GB', opts);
  const end = new Date(endIso).toLocaleDateString('en-GB', opts);
  return `${start} – ${end}`;
}

// ─── AI narrative ─────────────────────────────────────────────────────────────

async function generateNarrative(stats) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[Digest]: ANTHROPIC_API_KEY missing — skipping narrative');
    return 'Your week in numbers is below. Review your top leads and keep the momentum going.';
  }

  const client = new Anthropic({ apiKey });

  const compact = {
    leads_this_week: stats.leads_this_week,
    leads_last_week: stats.leads_last_week,
    lead_trend_pct: stats.lead_trend_pct,
    high_priority: stats.high_priority_count,
    medium_priority: stats.medium_priority_count,
    leads_won: stats.leads_won,
    invoices_sent: stats.invoices_sent,
    invoice_value_gbp: stats.invoice_value_gbp,
    invoices_paid: stats.invoices_paid,
    pending_drafts: stats.pending_drafts,
    top_leads_count: stats.top_leads_to_chase.length,
  };

  const prompt = `You are a sales assistant for a wholesale distribution business in the UK/South Asia market.
Write exactly 2 sentences summarising this week's sales performance in an encouraging, direct tone. Mention the most important action for this week.
Data: ${JSON.stringify(compact)}
Rules: No emojis. No generic advice. Be specific to the numbers. Max 60 words.`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    });
    return message.content[0]?.text?.trim() || 'Good progress this week — keep chasing your high-priority leads.';
  } catch (err) {
    console.error(`[Digest]: Anthropic narrative failed — ${err.message}`);
    return 'Your week in numbers is below. Review your high-priority leads before the week gets away from you.';
  }
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function trendArrow(pct) {
  if (pct === null || pct === undefined) return '';
  if (pct > 0) return `<span style="color:#22c55e;font-weight:700;">↑ ${Math.abs(Math.round(pct))}%</span>`;
  if (pct < 0) return `<span style="color:#ef4444;font-weight:700;">↓ ${Math.abs(Math.round(pct))}%</span>`;
  return `<span style="color:#94a3b8;font-weight:700;">→ 0%</span>`;
}

function kpiBox(emoji, label, value) {
  return `
    <td style="width:33.3%;padding:16px 8px;text-align:center;border:1px solid #e2e8f0;border-radius:8px;background:#ffffff;" class="kpi-cell">
      <div style="font-size:24px;line-height:1;">${emoji}</div>
      <div style="font-size:22px;font-weight:700;color:#0f172a;margin:6px 0 4px;">${value}</div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
    </td>`;
}

function chaseRow(lead, idx) {
  const bg = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
  const days = lead.days_since_contact;
  const daysLabel = days === null ? 'Never contacted' : `${days}d ago`;
  const daysColor = days === null || days >= 7 ? '#ef4444' : days >= 4 ? '#f59e0b' : '#64748b';

  return `
    <tr style="background:${bg};">
      <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;">
        <div style="font-weight:600;color:#0f172a;font-size:14px;">${escHtml(lead.customer_name || 'Unknown')}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">${escHtml(lead.company_name || '')}${lead.product_interest ? ` · ${escHtml(lead.product_interest)}` : ''}</div>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;text-align:center;">
        <span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:#fef2f2;color:#dc2626;font-size:11px;font-weight:700;">
          PTC ${lead.ptc_score}
        </span>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;text-align:right;color:${daysColor};font-weight:600;font-size:13px;">
        ${daysLabel}
      </td>
    </tr>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildEmailHtml(stats, narrative) {
  const dateRange = formatDateRange(stats.week_start, stats.week_end);
  const trendHtml = trendArrow(stats.lead_trend_pct);
  const heroEmoji = (stats.lead_trend_pct ?? 0) >= 0 ? '📈' : '📉';

  const chaseRows = stats.top_leads_to_chase.length > 0
    ? stats.top_leads_to_chase.map((l, i) => chaseRow(l, i)).join('')
    : `<tr><td colspan="3" style="padding:20px;text-align:center;color:#94a3b8;font-size:13px;">No overdue high-priority leads — great work!</td></tr>`;

  const draftsBox = stats.pending_drafts > 0
    ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;">
          <span style="font-size:16px;">💬</span>
          <span style="font-size:14px;font-weight:600;color:#92400e;margin-left:8px;">
            ${stats.pending_drafts} message draft${stats.pending_drafts !== 1 ? 's' : ''} waiting for your approval
          </span>
          &nbsp;
          <a href="/app/drafts" style="display:inline-block;margin-left:8px;padding:6px 14px;background:#0f172a;color:#ffffff;font-size:12px;font-weight:700;border-radius:6px;text-decoration:none;">
            Review Drafts →
          </a>
        </td>
      </tr>
    </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Weekly Sales Digest</title>
<style>
  @media only screen and (max-width:600px) {
    .wrapper { width:100% !important; }
    .kpi-cell { display:block !important; width:100% !important; margin-bottom:8px !important; box-sizing:border-box !important; }
    .kpi-row { display:block !important; }
    .hero-number { font-size:42px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0;">
  <tr>
    <td align="center">
      <table class="wrapper" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td style="background:#0f172a;border-radius:12px 12px 0 0;padding:28px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.3px;">
                    📊 Invisible Sales OS
                  </div>
                  <div style="color:#94a3b8;font-size:13px;margin-top:4px;">
                    Weekly Digest · ${escHtml(dateRange)}
                  </div>
                </td>
                <td align="right">
                  <div style="color:#64748b;font-size:12px;">
                    ${escHtml(stats.tenant_name || 'Your Business')}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="background:#ffffff;padding:32px;">

            <!-- HERO STAT -->
            <table width="100%" cellpadding="0" cellspacing="0" style="text-align:center;margin-bottom:28px;">
              <tr>
                <td>
                  <div style="font-size:48px;line-height:1;">${heroEmoji}</div>
                  <div class="hero-number" style="font-size:56px;font-weight:800;color:#0f172a;line-height:1;margin:8px 0 4px;">
                    ${stats.leads_this_week}
                  </div>
                  <div style="font-size:15px;color:#64748b;">
                    new leads this week &nbsp;${trendHtml}&nbsp; vs last week
                  </div>
                </td>
              </tr>
            </table>

            <!-- KPI ROW -->
            <table width="100%" cellpadding="0" cellspacing="0" class="kpi-row" style="border-collapse:separate;border-spacing:8px 0;margin-bottom:32px;">
              <tr>
                ${kpiBox('✅', 'Leads Won', stats.leads_won)}
                ${kpiBox('📧', 'Invoices Sent', stats.invoices_sent)}
                ${kpiBox('💷', 'Invoiced', `£${Number(stats.invoice_value_gbp).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`)}
              </tr>
            </table>

            <!-- CHASE SECTION -->
            <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:12px;">
              🔴 Top ${stats.top_leads_to_chase.length > 0 ? stats.top_leads_to_chase.length : ''} to Chase This Week
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;margin-bottom:28px;overflow:hidden;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Lead</th>
                  <th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Score</th>
                  <th style="padding:10px 16px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Last Contact</th>
                </tr>
              </thead>
              <tbody>
                ${chaseRows}
              </tbody>
            </table>

            <!-- AI NARRATIVE -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:#f8fafc;border-left:4px solid #0f172a;border-radius:0 8px 8px 0;padding:16px 20px;">
                  <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">
                    AI Summary
                  </div>
                  <div style="font-size:14px;color:#334155;line-height:1.6;">
                    ${escHtml(narrative)}
                  </div>
                </td>
              </tr>
            </table>

            <!-- DRAFTS CTA -->
            ${draftsBox}

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f1f5f9;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
            <div style="font-size:12px;color:#94a3b8;">
              Powered by <strong style="color:#64748b;">Invisible Sales OS</strong>
              &nbsp;·&nbsp;
              <a href="#unsubscribe" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a>
            </div>
            <div style="font-size:11px;color:#cbd5e1;margin-top:4px;">
              Sent every Monday at 8am UTC
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Collects a week's worth of stats for a tenant and generates an HTML digest email.
 * @param {Object} supabase - Supabase client
 * @param {string} tenantId
 * @returns {Promise<{subject: string, html: string, stats: Object}>}
 */
export async function generateWeeklyDigest(supabase, tenantId) {
  const { weekStart, weekEnd, prevWeekStart, prevWeekEnd } = getWeekRange();

  const weekStartIso = weekStart.toISOString();
  const weekEndIso = weekEnd.toISOString();
  const prevWeekStartIso = prevWeekStart.toISOString();
  const prevWeekEndIso = prevWeekEnd.toISOString();

  // ── 1. Tenant name ──────────────────────────────────────────────────────────
  let tenantName = 'Your Business';
  try {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single();
    if (tenant?.name) tenantName = tenant.name;
  } catch (_) { /* non-fatal */ }

  // ── 2. Leads this week ──────────────────────────────────────────────────────
  const { data: leadsThisWeek, error: lwErr } = await supabase
    .from('smart_leads')
    .select('id, ptc_score, pipeline_stage, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', weekStartIso)
    .lte('created_at', weekEndIso);

  if (lwErr) console.error('[Digest]: leads this week query error:', lwErr.message);
  const leads = leadsThisWeek || [];

  // ── 3. Leads previous week ──────────────────────────────────────────────────
  const { data: leadsPrevWeek } = await supabase
    .from('smart_leads')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('created_at', prevWeekStartIso)
    .lte('created_at', prevWeekEndIso);

  const leadsLastWeek = typeof leadsPrevWeek === 'number'
    ? leadsPrevWeek
    : (leadsPrevWeek?.length ?? 0);

  // ── 4. Priority breakdown ───────────────────────────────────────────────────
  const highPriorityCount = leads.filter(l => (l.ptc_score ?? 0) >= 70).length;
  const mediumPriorityCount = leads.filter(l => (l.ptc_score ?? 0) >= 40 && (l.ptc_score ?? 0) < 70).length;
  const leadsWon = leads.filter(l => l.pipeline_stage === 'won').length;

  // ── 5. Top leads to chase ───────────────────────────────────────────────────
  // High priority, not won, stale for 3+ days
  const threeDaysAgo = new Date();
  threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);

  const { data: allHighLeads } = await supabase
    .from('smart_leads')
    .select('id, customer_name, company_name, product_interest, ptc_score, created_at')
    .eq('tenant_id', tenantId)
    .gte('ptc_score', 70)
    .neq('pipeline_stage', 'won')
    .order('ptc_score', { ascending: false })
    .limit(20);

  const highLeads = allHighLeads || [];

  // For each high-priority lead, get their last activity date
  const topLeadsToChase = [];
  for (const lead of highLeads) {
    if (topLeadsToChase.length >= 3) break;

    const { data: lastActivity } = await supabase
      .from('lead_activities')
      .select('created_at')
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let daysSinceContact = null;
    if (lastActivity?.created_at) {
      const last = new Date(lastActivity.created_at);
      daysSinceContact = Math.floor((Date.now() - last.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Include if never contacted OR last contact was 3+ days ago
    if (daysSinceContact === null || daysSinceContact >= 3) {
      topLeadsToChase.push({
        customer_name: lead.customer_name,
        company_name: lead.company_name,
        product_interest: lead.product_interest,
        ptc_score: lead.ptc_score,
        days_since_contact: daysSinceContact,
      });
    }
  }

  // ── 6. Invoices this week ───────────────────────────────────────────────────
  const { data: invoicesThisWeek } = await supabase
    .from('invoices')
    .select('total_amount, status')
    .eq('tenant_id', tenantId)
    .in('direction', ['outbound', 'quote'])
    .gte('created_at', weekStartIso)
    .lte('created_at', weekEndIso);

  const invoices = invoicesThisWeek || [];
  const invoicesSent = invoices.length;
  const invoiceValueGbp = invoices.reduce((sum, inv) => sum + (parseFloat(inv.total_amount) || 0), 0);
  const invoicesPaid = invoices.filter(inv => inv.status === 'paid').length;

  // ── 7. Pending drafts ───────────────────────────────────────────────────────
  const { count: pendingDrafts } = await supabase
    .from('smart_interactions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('direction', 'outbound_draft');

  // ── 8. Build stats ──────────────────────────────────────────────────────────
  const leadsThisWeekCount = leads.length;
  const leadTrendPct = leadsLastWeek > 0
    ? ((leadsThisWeekCount - leadsLastWeek) / leadsLastWeek) * 100
    : null;

  const stats = {
    tenant_name: tenantName,
    week_start: weekStartIso,
    week_end: weekEndIso,
    leads_this_week: leadsThisWeekCount,
    leads_last_week: leadsLastWeek,
    lead_trend_pct: leadTrendPct !== null ? Math.round(leadTrendPct * 10) / 10 : null,
    high_priority_count: highPriorityCount,
    medium_priority_count: mediumPriorityCount,
    leads_won: leadsWon,
    pending_drafts: pendingDrafts ?? 0,
    invoices_sent: invoicesSent,
    invoice_value_gbp: Math.round(invoiceValueGbp * 100) / 100,
    invoices_paid: invoicesPaid,
    top_leads_to_chase: topLeadsToChase,
  };

  // ── 9. AI narrative ─────────────────────────────────────────────────────────
  const narrative = await generateNarrative(stats);

  // ── 10. Build email ─────────────────────────────────────────────────────────
  const html = buildEmailHtml(stats, narrative);
  const subject = `📊 Your Week in Sales — ${formatDateRange(stats.week_start, stats.week_end)}`;

  return { subject, html, stats };
}

/**
 * Generate and send the weekly digest to a given email address.
 * @param {Object} supabase
 * @param {string} tenantId
 * @param {string} toEmail
 * @returns {Promise<{ success: boolean, stats?: Object, error?: string }>}
 */
export async function sendWeeklyDigest(supabase, tenantId, toEmail) {
  try {
    const { subject, html, stats } = await generateWeeklyDigest(supabase, tenantId);

    const result = await sendEmailReply({ to: toEmail, subject, html });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    console.log(`📧 [Digest]: Sent to ${toEmail} for tenant ${stats.tenant_name}`);
    return { success: true, stats };
  } catch (err) {
    console.error(`❌ [Digest]: Failed for tenant ${tenantId} — ${err.message}`);
    return { success: false, error: err.message };
  }
}
