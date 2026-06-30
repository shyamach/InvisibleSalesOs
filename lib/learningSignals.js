/**
 * lib/learningSignals.js — Pure signal functions for the AI feedback loop.
 * These are extracted as pure functions so they can be tested without any I/O.
 */

/**
 * Calculate the signal weight for an ai_learning record based on action + outcome.
 *
 * @param {string} action   — 'approved' | 'edited' | 'dismissed' | 'escalated'
 * @param {string} outcome  — 'replied' | 'no_reply' | 'won' | 'lost' | null
 * @returns {number}        — weight in range [-1.0, 1.0]
 */
export function calculateSignalWeight(action, outcome) {
  // Positive outcomes
  if (action === 'approved' && outcome === 'replied') return 1.0;
  if (action === 'approved' && outcome === 'won') return 1.0;
  if (action === 'approved' && outcome === 'no_reply') return 0.3;
  if (action === 'approved' && !outcome) return 0.3; // sent but outcome unknown yet
  if (action === 'edited' && outcome === 'replied') return 0.8;
  if (action === 'edited' && outcome === 'won') return 0.8;
  if (action === 'edited' && outcome === 'no_reply') return 0.1;
  if (action === 'edited' && !outcome) return 0.1;
  if (action === 'dismissed') return -0.5;
  if (action === 'escalated') return -0.2; // escalated means draft wasn't good enough
  return 0;
}

/**
 * Compare original and edited draft text to quantify the edit.
 *
 * @param {string} original — the AI-generated draft before human edits
 * @param {string} edited   — the final text sent by the human
 * @returns {{ wordCountDiff: number, direction: 'shortened'|'lengthened'|'unchanged', changedWords: number }}
 */
export function extractEditDelta(original, editedText) {
  if (!original || !editedText) {
    return { wordCountDiff: 0, direction: 'unchanged', changedWords: 0 };
  }

  const originalWords = original.trim().split(/\s+/);
  const editedWords = editedText.trim().split(/\s+/);

  const originalCount = originalWords.length;
  const editedCount = editedWords.length;
  const wordCountDiff = editedCount - originalCount;

  let direction = 'unchanged';
  if (wordCountDiff < 0) direction = 'shortened';
  else if (wordCountDiff > 0) direction = 'lengthened';

  // Count words that differ between original and edited (simple set diff)
  const originalSet = new Set(originalWords.map((w) => w.toLowerCase()));
  const editedSet = new Set(editedWords.map((w) => w.toLowerCase()));
  const changedWords = [...editedSet].filter((w) => !originalSet.has(w)).length;

  return { wordCountDiff, direction, changedWords };
}
