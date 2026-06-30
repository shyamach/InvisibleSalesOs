import { describe, it, expect } from 'vitest';
import {
  sanitizeCell,
  hasBinarySignature,
  parseCSVToRows,
  validateImportRow,
  MAX_FILE_BYTES,
  MAX_ROWS,
} from '../lib/productImport.js';

// ─── sanitizeCell ──────────────────────────────────────────────────────────────

describe('sanitizeCell', () => {
  it('passes through a normal value unchanged', () => {
    expect(sanitizeCell('Basmati Rice')).toBe('Basmati Rice');
  });

  it('strips leading = (formula injection)', () => {
    expect(sanitizeCell('=SUM(A1:A10)')).toBe('SUM(A1:A10)');
  });

  it('strips multiple leading injection chars', () => {
    expect(sanitizeCell('+=@IMPORTRANGE("x")')).toBe('IMPORTRANGE("x")');
  });

  it('returns non-string values untouched', () => {
    expect(sanitizeCell(42)).toBe(42);
    expect(sanitizeCell(null)).toBe(null);
  });
});

// ─── hasBinarySignature ────────────────────────────────────────────────────────

describe('hasBinarySignature', () => {
  it('returns false for a plain CSV buffer', () => {
    const buf = Buffer.from('name,sku\nRice,R1\n');
    expect(hasBinarySignature(buf)).toBe(false);
  });

  it('returns true for XLSX magic bytes (PK)', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(hasBinarySignature(buf)).toBe(true);
  });

  it('returns true for PDF magic bytes (%PDF)', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(hasBinarySignature(buf)).toBe(true);
  });

  it('returns false for an empty buffer', () => {
    expect(hasBinarySignature(Buffer.alloc(0))).toBe(false);
  });
});

// ─── parseCSVToRows ────────────────────────────────────────────────────────────

describe('parseCSVToRows', () => {
  it('parses a simple CSV into row objects keyed by header', () => {
    const csv = 'name,sku,price\nBasmati Rice,R1,4.99\nFlour,F2,1.50\n';
    const result = parseCSVToRows(Buffer.from(csv));
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ name: 'Basmati Rice', sku: 'R1', price: '4.99' });
  });

  it('strips a UTF-8 BOM prepended by Excel', () => {
    const bom = '﻿';
    const csv = `${bom}name,price\nRice,5.00\n`;
    const result = parseCSVToRows(Buffer.from(csv, 'utf-8'));
    expect(result.ok).toBe(true);
    expect(result.rows[0].name).toBe('Rice');
  });

  it('normalises human-friendly header names (spaces → underscores, lower-case)', () => {
    const csv = 'Name,Stock Quantity,Unit Price\nRice,10,2.50\n';
    const result = parseCSVToRows(Buffer.from(csv));
    expect(result.ok).toBe(true);
    expect(result.rows[0]).toMatchObject({ name: 'Rice', stock_quantity: '10', unit_price: '2.50' });
  });

  it('handles quoted fields containing commas', () => {
    const csv = 'name,description\n"Rice, Basmati","Long grain, aromatic"\n';
    const result = parseCSVToRows(Buffer.from(csv));
    expect(result.ok).toBe(true);
    expect(result.rows[0].name).toBe('Rice, Basmati');
    expect(result.rows[0].description).toBe('Long grain, aromatic');
  });

  it('returns ok:false when the "name" column is absent', () => {
    const csv = 'sku,price\nR1,4.99\n';
    const result = parseCSVToRows(Buffer.from(csv));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/name/i);
  });

  it('returns ok:false for a header-only file with no data rows', () => {
    const result = parseCSVToRows(Buffer.from('name,sku\n'));
    expect(result.ok).toBe(false);
  });
});

// ─── validateImportRow ─────────────────────────────────────────────────────────

describe('validateImportRow', () => {
  it('validates a complete row and returns coerced data', () => {
    const row = { name: 'Basmati Rice 5kg', sku: 'RICE-5K', price: '12.50', stock_quantity: '100', currency: 'GBP', unit: 'bag', status: 'active' };
    const result = validateImportRow(row, 2);
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe('Basmati Rice 5kg');
    expect(result.data.price).toBe(12.5);
    expect(result.data.stock_quantity).toBe(100);
  });

  it('rejects a row missing the required name field', () => {
    const result = validateImportRow({ sku: 'X', price: '5.00' }, 3);
    expect(result.ok).toBe(false);
    expect(result.errors[0].row).toBe(3);
    expect(result.errors[0].field).toMatch(/name/);
  });

  it('rejects a negative price', () => {
    const result = validateImportRow({ name: 'Test', price: '-1' }, 4);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'price')).toBe(true);
  });

  it('strips formula injection characters before validation', () => {
    const row = { name: '=CMD("rm -rf /")', sku: '=HYPERLINK("evil.com")', price: '5' };
    const result = validateImportRow(row, 5);
    expect(result.ok).toBe(true);
    // Formula prefix stripped; what remains is a valid non-empty name.
    expect(result.data.name.startsWith('=')).toBe(false);
    expect(result.data.sku).toBeDefined();
    expect(result.data.sku?.startsWith('=')).toBe(false);
  });

  it('applies default values when optional fields are omitted', () => {
    const result = validateImportRow({ name: 'Plain Rice' }, 6);
    expect(result.ok).toBe(true);
    expect(result.data.price).toBe(0);
    expect(result.data.currency).toBe('GBP');
    expect(result.data.status).toBe('active');
    expect(result.data.unit).toBe('unit');
  });
});

// ─── module constants ──────────────────────────────────────────────────────────

describe('module constants', () => {
  it('MAX_FILE_BYTES is 2 MB', () => {
    expect(MAX_FILE_BYTES).toBe(2 * 1024 * 1024);
  });

  it('MAX_ROWS is 2000', () => {
    expect(MAX_ROWS).toBe(2_000);
  });
});
