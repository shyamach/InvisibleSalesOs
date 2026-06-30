/**
 * Responder.js — Contextual WhatsApp reply generator.
 * Uses Claude Haiku for speed and cost efficiency on short conversational drafts.
 */
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

// Module-level singleton — do NOT instantiate per call
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Exponential backoff retry wrapper.
 */
async function withRetry(fn, retries = 3, delayMs = 800) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      const wait = delayMs * Math.pow(2, attempt);
      console.warn(`⚠️ [responder] Retrying in ${wait}ms... (${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// Language name map for prompt clarity
const LANGUAGE_NAMES = {
  en: 'English',
  ur: 'Urdu',
  hi: 'Hindi',
  pa: 'Punjabi',
  gu: 'Gujarati',
  ar: 'Arabic',
  mixed: 'the same mixed language/script as the original message',
};

const SCRIPT_NOTES = {
  ur: 'Use Nastaliq Urdu script.',
  hi: 'Use Devanagari script.',
  pa: 'Use Shahmukhi script (or Roman Punjabi if the original was Roman).',
  gu: 'Use Gujarati script.',
  ar: 'Use Arabic script.',
};

/**
 * Generate a tailored WhatsApp reply draft for a captured lead.
 *
 * @param {Object} leadData            — triage lead_data object
 * @param {string} rawMessage          — original message text from the user
 * @param {string} [language='en']     — ISO language code for the reply
 * @param {Array}  [successfulExamples=[]] — prior successful reply examples from brand_dna
 * @param {string|null} [catalogueContext=null] — real price/stock context (from lib/catalogueContext)
 * @returns {{ success: boolean, draft?: string, reason?: string }}
 */
export async function generateSalesDraft(leadData, rawMessage, language = 'en', successfulExamples = [], catalogueContext = null) {
  console.log(`✍️  [Responder]: Drafting reply for ${leadData.customer_name || 'Prospect'} in lang=${language}...`);

  const langName = LANGUAGE_NAMES[language] || 'English';
  const scriptNote = SCRIPT_NOTES[language] || '';

  // Build language instruction block
  let languageBlock = '';
  if (language !== 'en') {
    languageBlock = `\nLANGUAGE REQUIREMENT:\nWrite the reply in ${langName}. ${scriptNote} Match the script and register (formal/informal) of the original message.\n`;
  }

  // Build few-shot examples block
  let examplesBlock = '';
  if (successfulExamples.length > 0) {
    const exLines = successfulExamples
      .slice(0, 3)
      .map((ex, i) => `Example ${i + 1}:\n  Customer: "${ex.original_message}"\n  Reply: "${ex.draft}"`)
      .join('\n\n');
    examplesBlock = `\nHere are examples of previous replies that got positive responses from this client's customers:\n${exLines}\n`;
  }

  // Real catalogue context (price/stock) so the draft never invents products.
  const catalogueBlock = catalogueContext ? `\n${catalogueContext}\n` : '';

  const prompt = `You are an elite, highly persuasive B2B Sales Closer.
A new inbound lead has been captured via WhatsApp.

Lead Context:
- Name: ${leadData.customer_name || 'Not provided'}
- Company: ${leadData.company_name || 'Not provided'}
- Product Interest: ${leadData.product_interest || 'Not specified'}
- Intent/Reasoning: ${leadData.intent_category || leadData.reason || ''}

Original Message: "${rawMessage}"
${examplesBlock}${languageBlock}${catalogueBlock}
YOUR MISSION:
Write a tailored, professional, and conversational WhatsApp reply to this lead.

RULES:
1. Keep it concise (under 3 sentences). This is WhatsApp, not email.
2. Acknowledge their specific interest.
3. End with a low-friction Call To Action (e.g., asking a qualifying question, offering to send a catalog, or suggesting a quick call).
4. Return ONLY the drafted message text. No quotes, no JSON, no preamble.`;

  try {
    const msg = await withRetry(() =>
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', // Haiku: fast and cost-efficient for short WhatsApp drafts
        max_tokens: 300, // slightly higher to allow non-Latin scripts
        messages: [{ role: 'user', content: prompt }],
      })
    );

    return { success: true, draft: msg.content[0].text.trim() };
  } catch (error) {
    console.error('💥 [Responder] Error generating draft:', error.message);
    return { success: false, reason: 'API error' };
  }
}
