/**
 * controllers/productImport.js — POST /api/products/import
 *
 * Accepts a CSV file (multipart/form-data, field name "file"), validates every
 * row against the product schema, and batch-inserts into the products table.
 *
 * Security constraints enforced here:
 *  - tenant_id stamped from req headers server-side, NEVER from the file
 *  - Dedicated multer instance (not shared with invoice uploads)
 *  - Extension + magic-byte checks before parsing
 *  - Formula-injection characters stripped in validateImportRow (lib/productImport.js)
 *  - Duplicate SKUs: skipped (ON CONFLICT DO NOTHING semantics)
 *  - Initial stock routed through stock_movements ledger (DB Lead requirement)
 */

import multer from 'multer';
import { supabase } from '../lib/supabase.js';
import { deriveStatusFromStock } from '../lib/catalogue.js';
import {
  MAX_FILE_BYTES,
  MAX_ROWS,
  hasBinarySignature,
  parseCSVToRows,
  validateImportRow,
} from '../lib/productImport.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
const tenantOf = (req) => req.headers['x-tenant-id'] || DEFAULT_TENANT_ID;

// Dedicated multer instance — separate from invoice uploads intentionally.
const _multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      return cb(Object.assign(new Error('Only .csv files are accepted.'), { code: 'INVALID_TYPE' }));
    }
    cb(null, true);
  },
}).single('file');

/**
 * Express middleware that wraps multer so size / type errors become structured
 * JSON responses instead of falling through to the default error handler.
 */
export function csvUpload(req, res, next) {
  _multerUpload(req, res, (err) => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ success: false, error: err.message });
  });
}

/**
 * POST /api/products/import
 *
 * Expects:
 *   Content-Type: multipart/form-data
 *   Field:        file  — a .csv file
 *   Header:       x-tenant-id (optional; falls back to DEFAULT_TENANT_ID)
 *
 * Response:
 *   200: { success: true, created: N, skipped: N, errors: [{row, field?, message}] }
 *   400: { success: false, error: string }
 *   413: { success: false, error: string }   ← file too large
 */
export async function importProducts(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded. Send the CSV as a "file" field.' });
  }

  // Magic-byte check: reject XLSX, PDF, PE, OLE2 even if renamed to .csv.
  if (hasBinarySignature(req.file.buffer)) {
    return res.status(400).json({ success: false, error: 'File rejected: binary content detected. Upload a plain CSV.' });
  }

  const parsed = parseCSVToRows(req.file.buffer);
  if (!parsed.ok) {
    return res.status(400).json({ success: false, error: parsed.error });
  }

  if (parsed.rows.length > MAX_ROWS) {
    return res.status(400).json({
      success: false,
      error: `File exceeds the ${MAX_ROWS.toLocaleString()} row limit (got ${parsed.rows.length} rows). Split the file and import in batches.`,
    });
  }

  const tenantId = tenantOf(req);
  const results = { created: 0, skipped: 0, errors: [] };

  for (const [idx, rawRow] of parsed.rows.entries()) {
    const rowNumber = idx + 2; // Row 1 = header; data starts at 2
    const v = validateImportRow(rawRow, rowNumber);

    if (!v.ok) {
      results.errors.push(...v.errors);
      continue;
    }

    const { stock_quantity: initialStock, ...productFields } = v.data;
    // Derive initial status from the stock quantity being imported.
    const derivedStatus = deriveStatusFromStock(initialStock, v.data.status);

    // Insert the product row with stock_quantity = 0. Stock is applied via
    // stock_movements so every unit is traceable in the ledger.
    const { data: inserted, error: insertErr } = await supabase
      .from('products')
      .insert({
        ...productFields,
        status: derivedStatus,
        stock_quantity: 0,
        tenant_id: tenantId,
      })
      .select('id')
      .maybeSingle();

    if (insertErr) {
      // 23505 = unique_violation (duplicate SKU within tenant — soft-deleted or active).
      if (insertErr.code === '23505') {
        results.skipped++;
        continue;
      }
      results.errors.push({ row: rowNumber, message: insertErr.message });
      continue;
    }

    // If the imported row carries a non-zero opening stock, record a stock movement.
    // The BEFORE INSERT trigger on stock_movements will update products.stock_quantity.
    if (initialStock > 0 && inserted?.id) {
      const { error: movErr } = await supabase.from('stock_movements').insert({
        tenant_id: tenantId,
        product_id: inserted.id,
        delta: initialStock,
        balance_after: initialStock,
        reason: 'import',
      });
      if (movErr) {
        // Non-fatal: product was created, but the opening stock movement failed.
        // Log and continue so the caller can see the partial success.
        results.errors.push({
          row: rowNumber,
          message: `Product created but opening stock movement failed: ${movErr.message}`,
        });
      }
    }

    results.created++;
  }

  return res.json({ success: true, ...results });
}
