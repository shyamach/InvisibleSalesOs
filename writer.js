/**
 * writer.js — Hyper-personalized outreach draft generator.
 * Uses Claude Sonnet for high-quality B2B copywriting.
 * Accepts optional brandContext (guidelines + RAG history) from engine.js.
 */
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

// Module-level singleton — instantiated once, not per call
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Exponential backoff retry wrapper.
 */
async function withRetry(fn, retries = 3, delayMs = 1000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      const wait = delayMs * Math.pow(2, attempt);
      console.warn(
        `⚠️ [writer] API error, retrying in ${wait}ms... (attempt ${attempt + 1}/${retries})`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

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
    const response = await withRetry(() =>
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
      })
    );
    return response.content[0].text;
  } catch (error) {
    console.error('❌ [writer] Personalization engine failure:', error.message);
    return null;
  }
}
