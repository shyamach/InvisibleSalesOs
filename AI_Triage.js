/**
 * AI_Triage.js — Elite B2B Sales Gatekeeper.
 * Classifies inbound messages and scores lead quality.
 * Uses Claude Haiku for speed and cost efficiency on triage calls.
 */
import { anthropic, withRetry } from './lib/anthropicClient.js';

/**
 * Perform AI triage on an inbound message bundle.
 *
 * @param {string[]} bundle   — array of message strings (joined into single context)
 * @param {Object|null} media — optional { data: base64, mimeType: string }
 * @returns {{ success: boolean, data?: Object, reason?: string }}
 */
export async function performAITriage(bundle, media = null) {
  console.log('🧠 [Triage]: Analyzing intent via Claude Haiku...');

  const text = bundle.filter(Boolean).join(' ').slice(0, 1500); // hard cap — no value in sending novels

  // Compact prompt: system role sets context, user turn is data-only.
  // Splitting system/user lets Haiku focus the classification without re-reading role description each time.
  const SYSTEM = `B2B sales gatekeeper. Classify inbound messages as leads or noise. Return ONLY valid JSON, no markdown.

Noise → {"is_lead":false,"score":0,"reason":"<why>","detected_language":"en","reply_language":"en"}
Lead  → {"is_lead":true,"priority":"HIGH"|"MEDIUM"|"LOW","score":0-100,"reason":"<why>","lead_data":{"customer_name":"<name or null>","company_name":"<company or null>","product_interest":"<product>","language":"<lang>"},"detected_language":"<code>","reply_language":"<code>"}

Score guide: HIGH=urgent/bulk/named company (70-100), MEDIUM=genuine interest (40-69), LOW=vague inquiry (1-39).

Language detection: Also detect the primary language of the message. Return detected_language as a 2-letter code (en/ur/hi/pa/gu/ar/mixed). Return reply_language as the same code — this is the language the reply should be written in. Use "mixed" if the message code-switches between languages. Language codes: en=English, ur=Urdu, hi=Hindi, pa=Punjabi, gu=Gujarati, ar=Arabic, mixed=code-switching.`;

  const userContent = media
    ? [
        { type: 'image', source: { type: 'base64', media_type: media.mimeType, data: media.data } },
        { type: 'text', text: `Classify: "${text}"` },
      ]
    : `Classify: "${text}"`;

  try {
    const msg = await withRetry(
      () =>
        anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 220,  // JSON output is small — was 500, cutting waste by 56%
          system: SYSTEM,
          messages: [{ role: 'user', content: userContent }],
        }),
      { label: 'triage' }
    );

    const rawResponse = msg.content[0].text.trim();

    // Bulletproof JSON extractor — strips any accidental prose wrapping
    const startIndex = rawResponse.indexOf('{');
    const endIndex = rawResponse.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1) {
      console.log('🛡️ [Triage]: No valid JSON in response.');
      return { success: false, reason: 'Parsing Failed: No JSON structure' };
    }

    const analysis = JSON.parse(rawResponse.substring(startIndex, endIndex + 1));

    // Gatekeeper: require is_lead AND minimum score threshold
    if (analysis.is_lead && analysis.score >= 50) {
      console.log(`🎯 [Triage]: ${analysis.priority} priority — ${analysis.reason} | lang: ${analysis.detected_language || 'en'}`);
      // Ensure language fields always present
      analysis.detected_language = analysis.detected_language || 'en';
      analysis.reply_language = analysis.reply_language || analysis.detected_language;
      return { success: true, data: analysis };
    } else {
      console.log(`🛡️ [Triage]: Noise detected. Reason: ${analysis.reason || 'low score'}`);
      return { success: false, reason: analysis.reason || 'low score / noise' };
    }
  } catch (error) {
    console.error('💥 [Triage] Error:', error.message);
    return { success: false, reason: 'API error during triage' };
  }
}
