/**
 * lib/productImport.js — Pure CSV import helpers.
 *
 * All functions are dependency-free so they unit-test without Supabase or Express.
 * Supabase writes live in controllers/productImport.js.
 */

import { productSchema, validate } from './catalogue.js';

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_ROWS = 2_000;

// Characters that, as the first character of a cell, trigger formula evaluation
// in Excel / Google Sheets — a CSV injection attack vector.
const FORMULA_STARTS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Strip leading formula-injection characters from a CSV cell value.
 * @param {unknown} value
 * @returns {string|unknown}
 */
export function sanitizeCell(value) {
  if (typeof value !== 'string') return value;
  let v = value.trim();
  while (v.length > 0 && FORMULA_STARTS.has(v[0])) {
    // Preserve signed numbers like -1 or +5: only strip when NOT followed by a digit.
    if ((v[0] === '-' || v[0] === '+') && v.length > 1 && /\d/.test(v[1])) break;
    v = v.slice(1).trim();
  }
  return v;
}

/**
 * Check whether a buffer begins with a known binary file signature.
 * Rejects XLSX/ZIP, old XLS, PDF, and PE executables at the byte level —
 * the client-provided Content-Type header is attacker-controlled and cannot
 * be relied upon alone.
 *
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function hasBinarySignature(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // XLSX / ZIP: PK\x03\x04
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return true;
  // Old XLS (OLE2 Compound Document): D0 CF 11 E0
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return true;
  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return true;
  // PE executable: MZ
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true;
  return false;
}

// ─── Internal CSV line parser ─────────────────────────────────────────────────
// Handles quoted fields (commas inside, escaped double-quotes).
// Does not support multiline cells (rare in catalogue data).
function parseCSVLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (c === ',' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * Parse a CSV buffer into an array of header-keyed row objects.
 *
 * - Strips UTF-8 BOM (Excel exports include it).
 * - Header names are lower-cased and non-alphanumeric chars replaced with `_`
 *   so "Stock Quantity" → "stock_quantity".
 * - Empty trailing lines are ignored.
 *
 * @param {Buffer} buffer
 * @returns {{ ok: true, rows: object[] } | { ok: false, error: string }}
 */
export function parseCSVToRows(buffer) {
  let text = buffer.toString('utf-8');
  // Strip UTF-8 BOM (﻿) that Excel prepends.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    return { ok: false, error: 'CSV must have a header row and at least one data row.' };
  }

  const headers = parseCSVLine(lines[0]).map((h) =>
    h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  );

  if (!headers.includes('name')) {
    return { ok: false, error: 'CSV is missing a required "name" column.' };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] !== undefined ? values[idx] : ''; });
    rows.push(obj);
  }

  return { ok: true, rows };
}

/**
 * Sanitize and validate a single parsed CSV row against the product schema.
 *
 * @param {object} rawRow     — object keyed by sanitised header names
 * @param {number} rowNumber  — 1-based row number in the original file (header = 1)
 * @returns {{ ok: true, data: object } | { ok: false, errors: Array<{row, field, message}> }}
 */
export function validateImportRow(rawRow, rowNumber) {
  // Sanitize every string field for formula-injection characters.
  const sanitized = {};
  for (const [k, v] of Object.entries(rawRow)) {
    sanitized[k] = sanitizeCell(v);
  }

  const result = validate(productSchema, sanitized);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.issues.map((issue) => ({
        row: rowNumber,
        field: issue.field,
        message: issue.message,
      })),
    };
  }
  return { ok: true, data: result.data };
}
