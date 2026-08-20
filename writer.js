/**
 * writer.js — Hyper-personalized outreach draft generator.
 * Uses Claude Sonnet for high-quality B2B copywriting.
 * Accepts optional brandContext (guidelines + RAG history) from engine.js.
 */
import { anthropic, withRetry } from './lib/anthropicClient.js';

/**
 * Generate a tailored outreach draft for a structured lead profile.
 *
 * @param {Object} profile       — structured lead from parser.js
 * @param {string} brandContext  — combined brand guidelines + RAG context from engine.js
 * @returns {string|null}        — outreach draft text, or null on failure
 */
export async function generateTailoredOutreach(profile, brandContext = '') {
  const baseInstructions = `You are an elite, highly sophisticated B2B Account Director representing a premium, quiet-luxury wellness and supplement manufacturing firm.
Your writing style is calm, confident, ultra-professional, and personalized. Avoid generic sales fluff, exclamation marks, or aggressive pitching.
Focus purely on operational execution and precision logistics.

Draft a crisp outreach email to the client based on their structured profile data.
Include a clear Subject Line and Body. Keep it concise, respectful, and focused on arranging a direct logistics call.`;

  const systemPrompt = brandContext
    ? `${brandContext}\n\n---\n\n${baseInstructions}`
    : baseInstructions;

  try {
    // Retry delay consolidated to the shared 800ms default (was 1000ms here
    // specifically) — Phase E, item E2: this had drifted from AI_Triage.js/
    // responder.js's 800ms with no evidence it was a deliberate choice.
    const response = await withRetry(
      () =>
        anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: `Generate a premium B2B outreach draft for this customer profile: ${JSON.stringify(profile)}`,
            },
          ],
        }),
      { label: 'writer' }
    );
    return response.content[0].text;
  } catch (error) {
    console.error('❌ [writer] Personalization engine failure:', error.message);
    return null;
  }
}
