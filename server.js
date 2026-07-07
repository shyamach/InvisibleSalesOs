/**
 * server.js — Express API gateway + WhatsApp ingestion (dual-mode).
 *
 * MODE A — Meta Cloud API (production)
 *   GET  /webhook/whatsapp  → Meta security handshake (verify_token)
 *   POST /webhook/whatsapp  → Inbound messages from Meta
 *   POST /webhook/email     → Inbound email via webhook (Mailgun / Postmark / SendGrid)
 *   POST /api/responder/dispatch → Send reply via Meta Cloud API (with whatsapp-web.js fallback)
 *
 * MODE B — whatsapp-web.js (dev/local fallback)
 *   The unofficial Puppeteer client continues running alongside Mode A.
 *   Dispatch falls back to client.sendMessage() if Meta API is not configured or fails.
 *
 * Architecture decision: Express starts IMMEDIATELY so Meta can verify the webhook
 * endpoint during setup. Do NOT gate app.listen() on WhatsApp being ready.
 *
 * Port: reads BACKEND_PORT first, then PORT, then defaults to 3001.
 * Set BACKEND_PORT=3001 in your .env.local to avoid clashing with Next.js (port 3000).
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '.env.local') });

import express from 'express';
import cors from 'cors';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import { performAITriage } from './AI_Triage.js';
import { generateSalesDraft } from './responder.js';
import { getCatalogueContext } from './lib/catalogueContext.js';
import { decideAutoReply } from './lib/autoReply.js';
import { detectEscalation } from './lib/escalation.js';
import { createAndNotifyEscalation } from './lib/escalationService.js';
import { supabase } from './lib/supabase.js';
import { sendWhatsAppMessage } from './lib/metaSend.js';
import { verifyWhatsAppWebhook, processWhatsAppWebhook } from './controllers/whatsapp.js';
import { handleInboundEmailParse } from './controllers/email.js';
import { handleFormLead } from './controllers/leadWebhook.js';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock,
  listStockMovements,
} from './controllers/products.js';
import {
  createEscalation,
  listEscalations,
  updateEscalation,
  getAttribution,
} from './controllers/escalations.js';
import { getAutoReplySettings, updateAutoReplySettings } from './controllers/settings.js';
import { listMembers, addMember, updateMemberRole, removeMember } from './controllers/team.js';
import { logCall } from './controllers/calls.js';
import { csvUpload, importProducts } from './controllers/productImport.js';
import { runFollowUpEngine } from './lib/followUpEngine.js';
import { sendPushToTenant } from './lib/pushNotify.js';
import { startEmailListener } from './lib/emailListener.js';
import multer from 'multer';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  convertQuoteToInvoice,
  updateInvoice,
  cancelInvoice,
  downloadInvoicePdf,
  uploadInvoice,
  saveInboundInvoice,
} from './controllers/invoices.js';
import { isWhatsAppInvoice, isLikelyInvoice } from './lib/invoiceParser.js';
import { registerTenant, getTenantStatus } from './controllers/tenants.js';
import { getPlans, getCurrentBilling, createCheckout, handleStripeWebhook } from './controllers/billing.js';
import { getDigestPreview, sendDigestPreview } from './controllers/digest.js';
import { startDigestScheduler } from './lib/digestScheduler.js';
import { startAutoReplySweeper } from './lib/autoReplySweeper.js';
import { requireAuth } from './lib/authMiddleware.js';
import { getMe, registerWithAuth } from './controllers/auth.js';

// Multer — in-memory storage for invoice file uploads (max 10 MB)
const invoiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = process.env.BACKEND_PORT || process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

// ─── Stripe Webhook — raw body MUST come before express.json() ────────────────
// Stripe requires the raw request body for signature verification.
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json());
app.use(cors({ origin: FRONTEND_URL }));

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireInternalKey(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// ─── Meta Cloud API Webhook Routes ───────────────────────────────────────────
// Must be registered BEFORE app.listen() — Meta verifies the endpoint during setup.

app.get('/webhook/whatsapp', verifyWhatsAppWebhook);
app.post('/webhook/whatsapp', processWhatsAppWebhook);
app.post('/webhook/email', handleInboundEmailParse);
app.post('/webhook/lead', handleFormLead);   // generic form webhook (Tally/Typeform/Forms) — rate-limited + Zod-validated
app.post('/api/calls', requireInternalKey, logCall);

// ─── Invoice Routes ───────────────────────────────────────────────────────────
app.get('/api/invoices',                        requireInternalKey, listInvoices);
app.get('/api/invoices/:id',                    requireInternalKey, getInvoice);
app.get('/api/invoices/:id/pdf',                requireInternalKey, downloadInvoicePdf);
app.post('/api/invoices',                       requireInternalKey, createInvoice);
app.post('/api/invoices/from-quote/:quoteId',   requireInternalKey, convertQuoteToInvoice);
app.patch('/api/invoices/:id',                  requireInternalKey, updateInvoice);
app.delete('/api/invoices/:id',                 requireInternalKey, cancelInvoice);
app.post('/api/invoices/upload',                requireInternalKey, invoiceUpload.single('invoice'), uploadInvoice);

// ─── Catalogue (Products) Routes ──────────────────────────────────────────────
app.get('/api/products',                 requireAuth, listProducts);
app.get('/api/products/:id',             requireAuth, getProduct);
app.post('/api/products',                requireAuth, createProduct);
app.patch('/api/products/:id',           requireAuth, updateProduct);
app.delete('/api/products/:id',          requireAuth, deleteProduct);
app.post('/api/products/:id/stock',      requireAuth, adjustStock);
app.get('/api/products/:id/movements',   requireAuth, listStockMovements);
app.post('/api/products/import',         requireAuth, csvUpload, importProducts);

// ─── Escalation (Sales-rep handoff) Routes ────────────────────────────────────
app.get('/api/escalations/attribution',  requireAuth, getAttribution);   // before /:id
app.get('/api/escalations',              requireAuth, listEscalations);
app.post('/api/escalations',             requireAuth, createEscalation);
app.patch('/api/escalations/:id',        requireAuth, updateEscalation);

// ─── Settings Routes ──────────────────────────────────────────────────────────
app.get('/api/settings/auto-reply',      requireAuth, getAutoReplySettings);
app.patch('/api/settings/auto-reply',    requireAuth, updateAutoReplySettings);

// ─── Team (Employee accounts) Routes ──────────────────────────────────────────
app.get('/api/team',             requireInternalKey, listMembers);
app.post('/api/team',            requireInternalKey, addMember);
app.patch('/api/team/:userId',   requireInternalKey, updateMemberRole);
app.delete('/api/team/:userId',  requireInternalKey, removeMember);

// ─── Auth Routes (JWT-based, user-facing) ─────────────────────────────────────
app.get('/api/auth/me',              requireAuth, getMe);
app.post('/api/auth/register',       requireAuth, registerWithAuth);

// ─── Tenant / Onboarding Routes ───────────────────────────────────────────────
app.post('/api/tenants/register',    requireInternalKey, registerTenant);
app.get('/api/tenants/:id/status',   requireInternalKey, getTenantStatus);

// ─── Billing Routes ───────────────────────────────────────────────────────────
app.get('/api/billing/plans',                getPlans);                              // public — pricing page
app.get('/api/billing/current',              requireAuth, getCurrentBilling);
app.post('/api/billing/create-checkout',     requireAuth, createCheckout);

// ─── Digest Routes ────────────────────────────────────────────────────────────
app.get('/api/digest/preview',       requireInternalKey, getDigestPreview);
app.post('/api/digest/send-preview', requireInternalKey, sendDigestPreview);

// ─── System Status ────────────────────────────────────────────────────────────

let whatsappStatus = 'disconnected';
let latestQr = null;

app.get('/api/status', (req, res) => {
  res.json({
    status: whatsappStatus,
    qr: latestQr,
    metaApiConfigured: !!(process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_ACCESS_TOKEN),
  });
});

// ─── Dispatch Endpoint ────────────────────────────────────────────────────────
// Protected by x-internal-key header (set by frontend's /api/dispatch proxy).
// Strategy: try Meta Cloud API first (phone number in DB), fall back to whatsapp-web.js.

app.post('/api/responder/dispatch', requireInternalKey, async (req, res) => {
  const { interaction_id } = req.body;

  if (!interaction_id) {
    return res.status(400).json({ success: false, error: 'Missing required parameter: interaction_id' });
  }

  try {
    const { data: interaction, error: intError } = await supabase
      .from('smart_interactions')
      .select(`
        id,
        message_content,
        direction,
        lead_id,
        channel,
        email_subject,
        smart_leads (
          id,
          lead_channel_id,
          source_channel,
          customer_name
        )
      `)
      .eq('id', interaction_id)
      .single();

    if (intError || !interaction) {
      return res.status(404).json({ success: false, error: 'Interaction not found.' });
    }

    if (interaction.direction !== 'outbound_draft') {
      return res.status(400).json({ success: false, error: 'Row is locked or already dispatched.' });
    }

    const targetPhone = interaction.smart_leads.lead_channel_id;
    const finalMessage = interaction.message_content;
    const contactName = interaction.smart_leads.customer_name || 'Prospect';
    const leadId = interaction.lead_id || interaction.smart_leads.id;

    // Determine channel: prefer stored channel field, fall back to source_channel on the lead
    const channel = interaction.channel || interaction.smart_leads.source_channel || 'whatsapp';

    console.log(`\n🚀 [Dispatch]: Sending to ${contactName} (${targetPhone}) via ${channel}`);

    let sent = false;

    // ── Channel routing ───────────────────────────────────────────────────────

    if (channel === 'email') {
      // ── Email path: send via Resend
      const { sendEmailReply } = await import('./lib/emailSend.js');
      const emailResult = await sendEmailReply({
        to: targetPhone, // for email leads, lead_channel_id = email address
        subject: interaction.email_subject || 'Following up on your enquiry',
        text: finalMessage,
      });

      if (emailResult.success) {
        sent = true;
        // Store Resend message ID on the interaction
        await supabase
          .from('smart_interactions')
          .update({ resend_id: emailResult.id })
          .eq('id', interaction_id);
        console.log(`✅ [Dispatch]: Sent via Resend email.`);
      } else {
        console.error(`❌ [Email dispatch failed]: ${emailResult.error}`);
        return res.status(503).json({ success: false, error: `Email send failed: ${emailResult.error}` });
      }
    } else {
      // ── WhatsApp path (default)

      // ── Attempt 1: Meta Cloud API (official, production)
      const metaResult = await sendWhatsAppMessage(targetPhone, finalMessage);
      if (metaResult.success) {
        sent = true;
        console.log(`✅ [Dispatch]: Sent via Meta Cloud API.`);
      } else {
        console.warn(`⚠️ [Dispatch]: Meta API failed — ${metaResult.error}. Trying whatsapp-web.js fallback...`);
      }

      // ── Attempt 2: whatsapp-web.js (local/dev fallback)
      if (!sent && whatsappStatus === 'connected') {
        try {
          await client.sendMessage(targetPhone, finalMessage);
          sent = true;
          console.log(`✅ [Dispatch]: Sent via whatsapp-web.js fallback.`);
        } catch (wErr) {
          console.error(`❌ [Dispatch]: whatsapp-web.js also failed — ${wErr.message}`);
        }
      }

      if (!sent) {
        return res.status(503).json({
          success: false,
          error: 'Could not send: Meta API unavailable and WhatsApp Web session not connected.',
        });
      }
    }

    // Mark as sent in DB
    await supabase
      .from('smart_interactions')
      .update({ direction: 'outbound_sent' })
      .eq('id', interaction_id);

    // Update ai_learning — mark as approved with the sent content
    await supabase
      .from('ai_learning')
      .update({ action: 'approved', draft_sent: finalMessage })
      .eq('interaction_id', interaction_id);

    // Log outbound activity
    if (leadId) {
      await supabase.from('lead_activities').insert({
        tenant_id: process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001',
        lead_id: leadId,
        type: channel === 'email' ? 'email_out' : 'whatsapp_out',
        channel,
        direction: 'outbound',
        content: finalMessage,
        metadata: { interaction_id },
      });
    }

    return res.json({ success: true, message: 'Message sent.' });

  } catch (error) {
    console.error('💥 Dispatch failure:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Draft Action Endpoint ────────────────────────────────────────────────────
// Called by the frontend UI when a human dismisses, escalates, or edits a draft.

app.post('/api/draft-action', requireInternalKey, async (req, res) => {
  const { interaction_id, action, edited_content } = req.body;

  if (!interaction_id || !action) {
    return res.status(400).json({ success: false, error: 'Missing required fields: interaction_id, action' });
  }

  const validActions = ['dismissed', 'escalated', 'edited'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ success: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
  }

  try {
    // Fetch the original draft to compute edit_delta if needed
    const { data: learningRow } = await supabase
      .from('ai_learning')
      .select('draft_original')
      .eq('interaction_id', interaction_id)
      .single();

    const updatePayload = { action };

    if (action === 'edited' && edited_content) {
      updatePayload.draft_sent = edited_content;
      updatePayload.was_edited = true;

      // Compute simple edit_delta: word count diff
      if (learningRow?.draft_original) {
        const originalWords = (learningRow.draft_original || '').trim().split(/\s+/).length;
        const editedWords = edited_content.trim().split(/\s+/).length;
        updatePayload.edit_delta = {
          word_count_diff: editedWords - originalWords,
          direction: editedWords < originalWords ? 'shortened' : editedWords > originalWords ? 'lengthened' : 'unchanged',
        };
      }
    }

    const { error: updateError } = await supabase
      .from('ai_learning')
      .update(updatePayload)
      .eq('interaction_id', interaction_id);

    if (updateError) {
      console.error('💥 [DraftAction]: DB update error:', updateError.message);
      return res.status(500).json({ success: false, error: 'Failed to update ai_learning' });
    }

    console.log(`📝 [DraftAction]: interaction ${interaction_id} marked as ${action}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('💥 [DraftAction]: Unexpected error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── START EXPRESS IMMEDIATELY ────────────────────────────────────────────────
// Do NOT wait for WhatsApp Web — Meta webhook verification needs the server online now.

app.listen(PORT, () => {
  console.log(`🌐 [Gateway]: REST API online → http://127.0.0.1:${PORT}`);
  console.log(`🔗 [Webhook]:  Meta webhook URL → http://127.0.0.1:${PORT}/webhook/whatsapp`);
  console.log(`   (Expose via ngrok for local dev: ngrok http ${PORT})`);

  // Weekly digest — fires every Monday at 8am UTC, one send per ISO week
  startDigestScheduler(supabase);
  console.log('📧 [Digest Scheduler]: Registered — fires Monday 8am UTC');

  // Auto-reply approval-window sweeper — dispatches scheduled drafts when their window elapses
  startAutoReplySweeper(supabase, { whatsappSender: (to, text) => client.sendMessage(to, text) });
  console.log('⏰ [AutoReplySweeper]: Registered — sweeps scheduled replies every 60s');
});

// ─── Follow-Up Engine Cron ────────────────────────────────────────────────────
// Runs every 6 hours. Finds stale leads and generates follow-up drafts.
const FOLLOW_UP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
setInterval(() => runFollowUpEngine(supabase), FOLLOW_UP_INTERVAL_MS);
// Also run once on startup (after a short delay so the server settles first)
setTimeout(() => runFollowUpEngine(supabase), 30_000);

// ─── Email IMAP Listener ──────────────────────────────────────────────────────
// Polls inbox every 60s when EMAIL_IMAP_ENABLED=true.
// Feeds emails through same AI triage + draft pipeline as WhatsApp.

startEmailListener(async (email) => {
  const TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

  console.log(`\n📧 [Email]: Processing "${email.subject}" from ${email.from}`);

  // Extract clean email address from "Name <email@domain.com>"
  const emailMatch = email.from.match(/<([^>]+)>/) || email.from.match(/([^\s]+@[^\s]+)/);
  const fromEmail = emailMatch ? emailMatch[1] : email.from;
  const fromName  = email.from.replace(/<[^>]+>/, '').trim() || null;

  // ── Invoice detection ─────────────────────────────────────────────────────
  // Check BEFORE lead triage — supplier invoices are not sales leads.
  if (isLikelyInvoice(email)) {
    console.log(`🧾 [Email Invoice]: Detected invoice email from ${fromEmail} — parsing...`);

    // PDF attachment if available, otherwise parse email body text
    const pdfBuffer = email.pdfAttachment || null;
    saveInboundInvoice(supabase, {
      tenantId:      TENANT_ID,
      sourceChannel: 'email',
      fromEmail,
      fromName,
      fileBuffer:    pdfBuffer,
      fileName:      email.pdfFilename || 'invoice.pdf',
      mimeType:      'application/pdf',
    }).catch(err => console.error('💥 [Invoice email error]:', err.message));

    return; // Not a sales lead
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Run AI triage on the email body
  const triageResult = await performAITriage([email.body], null);

  if (!triageResult.success) {
    console.log(`🛡️ [Email Gatekeeper]: Dropped. Reason: ${triageResult.reason}`);
    return;
  }

  const { data } = triageResult;

  // Save lead with source_channel='email'
  const { data: insertedLead, error: leadError } = await supabase
    .from('smart_leads')
    .insert({
      tenant_id: TENANT_ID,
      customer_name: data.lead_data.customer_name,
      company_name: data.lead_data.company_name,
      product_interest: data.lead_data.product_interest,
      ptc_score: data.score,
      intent_category: data.reason,
      triage_status: 'pending',
      lead_channel_id: fromEmail,
      email: fromEmail,
      source_channel: 'email',
      detected_language: data.detected_language || 'en',
      reply_language: data.reply_language || 'en',
      pipeline_stage: 'new',
    })
    .select('id')
    .single();

  if (leadError) {
    console.error('💥 [Email]: DB error saving lead:', leadError.message);
    return;
  }

  console.log(`🎯 [Email LEAD SAVED]: ID: ${insertedLead.id} | Score: ${data.score} | Priority: ${data.priority}`);

  // Push notification for HIGH email leads
  if (data.priority === 'HIGH') {
    sendPushToTenant(supabase, TENANT_ID, {
      title: '🔴 HIGH Priority Email Lead',
      body: `${data.lead_data.customer_name || fromEmail} — ${data.lead_data.product_interest || email.subject}`,
      url: '/app/drafts',
      tag: 'high-lead-email',
      requireInteraction: true,
    }).catch(err => console.warn('Push failed:', err.message));
  }

  // Log inbound email as activity
  await supabase.from('lead_activities').insert({
    tenant_id: TENANT_ID,
    lead_id: insertedLead.id,
    type: 'email_in',
    channel: 'email',
    direction: 'inbound',
    content: email.body,
    metadata: { from: email.from, subject: email.subject },
  });

  // Draft for HIGH + MEDIUM
  if (data.priority === 'HIGH' || data.priority === 'MEDIUM') {
    const { data: brandData } = await supabase
      .from('brand_dna')
      .select('successful_examples')
      .eq('tenant_id', TENANT_ID)
      .single();

    const examples = brandData?.successful_examples || [];

    const draftResult = await generateSalesDraft(
      data.lead_data,
      email.body,
      data.reply_language || 'en',
      examples.slice(0, 3)
    );

    if (draftResult.success) {
      const { data: insertedInteraction } = await supabase
        .from('smart_interactions')
        .insert({
          tenant_id: TENANT_ID,
          lead_id: insertedLead.id,
          message_content: draftResult.draft,
          direction: 'outbound_draft',
          channel: 'email',
          email_to: fromEmail,
          email_subject: `Re: ${email.subject}`,
        })
        .select('id')
        .single();

      if (insertedInteraction) {
        await supabase.from('ai_learning').insert({
          tenant_id: TENANT_ID,
          interaction_id: insertedInteraction.id,
          lead_id: insertedLead.id,
          draft_original: draftResult.draft,
          was_edited: false,
          action: 'pending',
          channel: 'email',
          detected_language: data.detected_language || 'en',
          signal_weight: 0,
        });
      }

      console.log(`✍️ [Email DRAFT READY]: Priority ${data.priority} — queued for approval.`);
    }
  }
});

// ─── WhatsApp Web Client (dev/local fallback) ─────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
});

// ─── Pipeline: whatsapp-web.js message ingestion ──────────────────────────────

const CLAUDE_VISION_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const NOISE_EXACT = new Set([
  'hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank you', 'ty', 'bye',
  'ping', 'yes', 'no', 'yep', 'nope', 'sure', 'k', 'cool', 'nice', 'good',
  'great', 'noted', 'done', 'np', 'lol', 'haha', 'hmm', 'oh', 'ah', 'wow',
  'seen', 'received', 'got it', 'on it', 'will do', 'please',
]);

client.on('message_create', async (msg) => {
  console.log(`\n📡 [Raw Event]: From: ${msg.from} | isMe: ${msg.fromMe}`);

  // STRICT FILTER: Block groups, newsletters, WhatsApp system, and own messages.
  // NOTE: @lid addresses (WhatsApp privacy layer) with isMe:false ARE real contacts.
  // msg.fromMe already covers own-device @lid events — do NOT add @lid to this list.
  if (
    msg.from.includes('@g.us') ||
    msg.from.includes('@newsletter') ||
    msg.from === '0@c.us' ||
    msg.from === 'status@broadcast' ||
    msg.fromMe
  ) {
    console.log(`🚫 [Filter]: Dropped — matched ignore list.`);
    return;
  }

  // ZERO-COST PRE-FILTER: Drop obvious noise before spending AI tokens.
  const cleanText = (msg.body || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
  const isEmojiOnly = !msg.hasMedia && /^[\p{Emoji}\s]+$/u.test(msg.body || '');
  if (
    !msg.hasMedia &&
    (NOISE_EXACT.has(cleanText) ||
      (cleanText.length < 20 && NOISE_EXACT.has(cleanText.split(' ')[0])) ||
      isEmojiOnly)
  ) {
    console.log(`🛡️ [Pre-Filter]: Dropped noise ("${cleanText}") — saved AI tokens.`);
    return;
  }

  // Fetch WhatsApp contact name before triage — fallback when AI can't extract a name from message text
  let contactDisplayName = null;
  try {
    const contact = await msg.getContact();
    contactDisplayName = contact.pushname || contact.name || null;
    if (contactDisplayName) console.log(`👤 [Contact]: ${contactDisplayName}`);
  } catch { /* non-fatal */ }

  console.log(`🧠 [System]: Valid contact detected. Routing to AI Triage...`);

  // Media download — only pass image types Claude's vision API accepts.
  let media = null;
  if (msg.hasMedia) {
    try {
      const data = await msg.downloadMedia();

      // ── Invoice PDF detection ────────────────────────────────────────────
      // Check BEFORE skipping — invoices arrive as document/PDF, not image.
      if (data && isWhatsAppInvoice(msg)) {
        const TENANT_ID_WA = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
        const pdfBuffer    = Buffer.from(data.data, 'base64');
        console.log(`🧾 [WhatsApp Invoice]: PDF detected from ${msg.from} — parsing...`);

        saveInboundInvoice(supabase, {
          tenantId:      TENANT_ID_WA,
          sourceChannel: 'whatsapp',
          fromEmail:     null,
          fromName:      contactDisplayName,
          fileBuffer:    pdfBuffer,
          fileName:      msg.filename || 'invoice.pdf',
          mimeType:      'application/pdf',
        }).catch(err => console.error('💥 [Invoice save error]:', err.message));

        return; // Don't run lead triage on an invoice document
      }
      // ────────────────────────────────────────────────────────────────────

      if (data && CLAUDE_VISION_TYPES.has(data.mimetype)) {
        media = { data: data.data, mimeType: data.mimetype };
      } else if (data) {
        console.log(`📎 [Media]: Skipping unsupported type "${data.mimetype}" — text-only triage.`);
      }
    } catch (err) {
      console.error('⚠️ Failed to download media:', err.message);
    }
  }

  // AI Triage
  const triageResult = await performAITriage([msg.body], media);

  if (!triageResult.success) {
    console.log(`🛡️ [Gatekeeper]: Bypassed. Reason: ${triageResult.reason}`);
    return;
  }

  const { data } = triageResult;

  const TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

  // Insert lead (with language fields from triage)
  const { data: insertedLead, error: leadError } = await supabase
    .from('smart_leads')
    .insert({
      tenant_id: TENANT_ID,
      customer_name: data.lead_data.customer_name || contactDisplayName,
      company_name: data.lead_data.company_name,
      product_interest: data.lead_data.product_interest,
      ptc_score: data.score,
      intent_category: data.reason,
      triage_status: 'pending',
      lead_channel_id: msg.from,
      source_channel: 'whatsapp',
      detected_language: data.detected_language || 'en',
      reply_language: data.reply_language || 'en',
      pipeline_stage: 'new',
    })
    .select('id')
    .single();

  if (leadError) {
    console.error('💥 DB error saving lead:', leadError.message);
    return;
  }

  console.log('🎯 [LEAD SAVED]: ID:', insertedLead.id);

  // Send push notification for HIGH priority leads
  if (data.priority === 'HIGH') {
    sendPushToTenant(supabase, TENANT_ID, {
      title: '🔴 HIGH Priority Lead',
      body: `${data.lead_data.customer_name || 'New contact'} — ${data.lead_data.product_interest || 'Enquiry'}`,
      url: '/app/drafts',
      tag: 'high-lead',
      requireInteraction: true,
    }).catch(err => console.warn('Push failed:', err.message));
  }

  // Log the inbound message as a lead activity
  await supabase.from('lead_activities').insert({
    tenant_id: TENANT_ID,
    lead_id: insertedLead.id,
    type: 'whatsapp_in',
    channel: 'whatsapp',
    direction: 'inbound',
    content: msg.body,
    metadata: { from: msg.from, has_media: msg.hasMedia },
  });

  // Draft generation for HIGH + MEDIUM only
  if (data.priority === 'HIGH' || data.priority === 'MEDIUM') {
    // Fetch brand_dna for language examples + tenant intelligence config (auto-reply, owner email)
    const { data: brandData } = await supabase
      .from('brand_dna')
      .select('successful_examples, reply_languages')
      .eq('tenant_id', TENANT_ID)
      .single();

    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('auto_reply, owner_email')
      .eq('id', TENANT_ID)
      .maybeSingle();

    const examples = brandData?.successful_examples || [];
    const replyLanguage = data.reply_language || 'en';

    // ── Catalogue context: feed REAL price/stock into the draft ────────────────
    let catalogue = { matches: [], context: null };
    try {
      catalogue = await getCatalogueContext(supabase, TENANT_ID, data.lead_data.product_interest);
    } catch (err) {
      console.warn('⚠️ [WhatsApp]: catalogue context fetch failed (non-fatal):', err.message);
    }

    const draftResult = await generateSalesDraft(
      data.lead_data,
      msg.body,
      replyLanguage,
      examples.slice(0, 3),
      catalogue.context
    );

    if (draftResult.success) {
      const { data: insertedInteraction, error: interactionError } = await supabase
        .from('smart_interactions')
        .insert({
          tenant_id: TENANT_ID,
          lead_id: insertedLead.id,
          message_content: draftResult.draft,
          direction: 'outbound_draft',
          channel: 'whatsapp',
        })
        .select('id')
        .single();

      if (!interactionError && insertedInteraction) {
        // ── Auto-reply decision (per-tenant toggle + per-priority rules) ────────
        const decision = decideAutoReply({
          priority: data.priority,
          score: data.score,
          tenantAutoReply: tenantRow?.auto_reply ?? null,
        });

        await supabase
          .from('smart_leads')
          .update({
            auto_reply_decision: decision.action,
            auto_reply_status: decision.status,
            scheduled_dispatch_at: decision.scheduled_dispatch_at,
          })
          .eq('id', insertedLead.id);

        // auto_dispatch → send NOW via the in-scope whatsapp-web.js client
        // (handles @lid device IDs that the Meta API can't). scheduled/manual
        // stay in the approval queue. NOTE: timed-window auto-send on WhatsApp
        // still needs the sweeper to reach this client — tracked as follow-up.
        let autoSent = false;
        if (decision.action === 'auto_dispatch') {
          try {
            await client.sendMessage(msg.from, draftResult.draft);
            autoSent = true;
            await supabase.from('smart_interactions').update({ direction: 'outbound' }).eq('id', insertedInteraction.id);
            await supabase.from('smart_leads').update({ last_contacted_at: new Date().toISOString(), pipeline_stage: 'contacted', auto_reply_status: 'sent' }).eq('id', insertedLead.id);
            await supabase.from('lead_activities').insert({
              tenant_id: TENANT_ID, lead_id: insertedLead.id, type: 'whatsapp_out', channel: 'whatsapp',
              direction: 'outbound', content: draftResult.draft, metadata: { auto_reply: true, reason: decision.reason },
            });
            console.log(`🤖 [Auto-reply]: ${data.priority} auto-sent via WhatsApp — ${decision.reason}`);
          } catch (err) {
            console.error('❌ [Auto-reply]: send failed, left in queue —', err.message);
          }
        }

        // Record in ai_learning for feedback loop
        await supabase.from('ai_learning').insert({
          tenant_id: TENANT_ID,
          interaction_id: insertedInteraction.id,
          lead_id: insertedLead.id,
          draft_original: draftResult.draft,
          draft_sent: autoSent ? draftResult.draft : null,
          was_edited: false,
          action: autoSent ? 'approved' : 'pending',
          channel: 'whatsapp',
          detected_language: data.detected_language || 'en',
          signal_weight: 0,
        });

        console.log(
          autoSent
            ? `✅ [Auto-reply]: Priority ${data.priority} sent automatically. Lang: ${replyLanguage}`
            : `🚀 [DRAFT READY]: Priority ${data.priority} — queued for approval. Lang: ${replyLanguage}`
        );
      }
    }

    // ── Sales-rep handoff: escalate OOS / price-negotiation leads ──────────────
    try {
      const escalation = detectEscalation({
        profile: { query: data.lead_data.product_interest, product_interest: data.lead_data.product_interest, customer_name: data.lead_data.customer_name || contactDisplayName, company: data.lead_data.company_name },
        catalogueMatches: catalogue.matches,
      });
      if (escalation.escalate) {
        console.log(`🚨 [WhatsApp]: Escalating to rep — ${escalation.reason} (${escalation.context})`);
        await createAndNotifyEscalation(supabase, {
          tenantId: TENANT_ID,
          leadId: insertedLead.id,
          reason: escalation.reason,
          context: escalation.context,
          profile: { customer_name: data.lead_data.customer_name || contactDisplayName, company: data.lead_data.company_name },
          ownerEmail: tenantRow?.owner_email ?? null,
        });
      }
    } catch (err) {
      console.warn('⚠️ [WhatsApp]: escalation failed (non-fatal):', err.message);
    }
  }
});

client.on('qr', (qr) => {
  whatsappStatus = 'awaiting_scan';
  latestQr = qr;
  console.log('⚠️ [WhatsApp]: QR code ready — scan to authenticate.');
});

client.on('authenticated', () => {
  whatsappStatus = 'connected';
  latestQr = null;
  console.log('✅ [WhatsApp]: Authenticated. Syncing chats...');
});

client.on('ready', () => {
  whatsappStatus = 'connected';
  console.log('🟢 [WhatsApp]: Session fully operational — whatsapp-web.js dispatch ready.');
});

client.on('disconnected', () => {
  whatsappStatus = 'disconnected';
  latestQr = null;
  console.log('🔴 [WhatsApp]: Session disconnected.');
});

// ─── Boot WhatsApp Web ────────────────────────────────────────────────────────
console.log('⏳ [System]: Spawning Chrome instance (WhatsApp Web fallback)...');
client.initialize();
