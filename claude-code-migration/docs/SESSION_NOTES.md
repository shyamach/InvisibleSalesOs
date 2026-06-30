# Session Notes — Invisible Sales OS (Claude Code)

_Running log of completed tasks. Newest entry first._

---

## Task 2 — Catalogue CSV import (`POST /api/products/import`)

**Date:** 2026-06-30
**Status:** Complete — 308/308 tests passing

### Why it was needed

The `products` table was empty with no fast path to populate it. Manual entry via the Add Product form works for a handful of items but not for wholesale catalogues with hundreds of SKUs.

### Agent review summary

Three agents reviewed the design before implementation:

- **Product Lead** — cut XLSX (SheetJS dependency not justified until a client specifically can't export CSV); cut `POST /webhook/products` to Phase 2 (needs per-tenant webhook token design first); approved CSV-only with inline result display. Definition of done: `{success, created, skipped, errors}` response; pure parser logic testable without Supabase; ≥5 tests.
- **Database Lead** — hard requirement: initial stock must route through `stock_movements` ledger (not written directly to `products.stock_quantity`); insert product with `stock_quantity=0`, then insert a `stock_movements` row with `delta=initial_qty` and `reason='import'`; skip on duplicate SKU (23505), including soft-deleted rows.
- **Security Lead** — `tenant_id` must come from server-side headers (`req.headers['x-tenant-id']`), never from the file or form body; dedicated multer instance; magic-byte validation to reject XLSX/PDF/PE disguised as CSV; formula-injection character stripping (`=`, `+`, `-`, `@`, `\t` at cell start — preserving signed numbers like `-1`).

`POST /webhook/products` deferred to Phase 2 (tracked in `OPEN_TASKS.md §4`).

### Files changed

| File | Change |
|---|---|
| `lib/productImport.js` | New — pure functions: `sanitizeCell`, `hasBinarySignature`, `parseCSVToRows`, `validateImportRow`, `MAX_FILE_BYTES`, `MAX_ROWS` |
| `tests/productImport.test.js` | New — 21 tests across all four pure functions + module constants |
| `controllers/productImport.js` | New — `csvUpload` middleware (dedicated multer, 2 MB, .csv only) + `importProducts` controller |
| `server.js` | One import line + one route: `POST /api/products/import` |
| `frontend/src/app/api/products/import/route.ts` | New — Next.js proxy; pipes raw `arrayBuffer` through to backend (preserves multipart boundary) |
| `frontend/src/app/app/catalogue/page.tsx` | "Import CSV" button in header + modal (file picker → result card with created/skipped/errors) |

### Behaviour added

- **`sanitizeCell(value)`** — strips leading formula-injection characters but preserves signed numbers (`-1` stays `-1`; `=SUM(...)` becomes `SUM(...)`).
- **`hasBinarySignature(buffer)`** — rejects XLSX (`PK\x03\x04`), old XLS (OLE2), PDF (`%PDF`), PE (`MZ`) at the byte level.
- **`parseCSVToRows(buffer)`** — minimal CSV parser: handles quoted fields with commas, escaped double-quotes, UTF-8 BOM, CRLF/LF. Normalises header names (`"Stock Quantity"` → `stock_quantity`).
- **`validateImportRow(rawRow, rowNumber)`** — sanitizes then validates against `productSchema` (Zod). Returns flat error list with row number.
- **`importProducts` controller** — per-row: validate → skip on 23505 → insert product with `stock_quantity=0` → if `initial_stock>0`, insert `stock_movements` row (`reason='import'`) → trigger updates `products.stock_quantity`. `tenant_id` always from server.
- **Import UI** — "Import CSV" button opens a modal. After upload: created/skipped counts + scrollable error list. "Import another file" resets.

### Test count

| | Tests | Files |
|---|---|---|
| Before | 287 | 26 |
| After | **308** | **27** |

All 308 passing.

### Design notes / follow-ups

1. **Soft-deleted SKU collision** — on 23505 the row is skipped with "duplicate SKU" message regardless of whether the existing product is active or soft-deleted. The user can hard-delete the archived product via the UI if they need to re-import.
2. **No new prod dependencies** — the CSV parser is a ~40-line state-machine written inline in `lib/productImport.js`. No `csv-parse` or SheetJS added.
3. **Stock trigger assumption** — controller trusts that the `BEFORE INSERT` trigger on `stock_movements` updates `products.stock_quantity`. If the trigger is absent in any env, the product will show `stock_quantity=0` until a manual stock adjustment is made. A follow-up test against a real DB would confirm this.
4. **`tenant_id` scope** — same `x-tenant-id` header pattern as other endpoints. The Security Lead's broader auth gap (open RLS) is tracked separately in the pre-launch checklist.

---

## Task 1 — Timed-window WhatsApp auto-send for @lid targets

**Date:** 2026-06-30
**Status:** Complete — 287/287 tests passing

### Why it was needed

MEDIUM-priority leads with an approval window were not auto-sending on WhatsApp. The 60-second `autoReplySweeper` dispatches via `outbox.js → lib/metaSend.js` (Meta Cloud API), which cannot deliver to `@lid` device-local identifiers used by whatsapp-web.js contacts. Those leads stayed permanently in the `scheduled` state unless manually approved. LOW auto-send already worked because it fires inline from the `server.js` wwebjs handler (which has direct access to the `client` object).

### Files changed

| File | Change |
|---|---|
| `lib/autoReplySweeper.js` | Added `isLidAddress(phone)` export; added `makeDispatch(whatsappSender, standardDispatch)` export; updated `startAutoReplySweeper` to accept `{ whatsappSender }` and build a hybrid dispatch |
| `tests/autoReplySweeper.test.js` | Expanded import; added 8 new tests across `isLidAddress` (3) and `makeDispatch` (5, including end-to-end) |
| `server.js` | One line: `startAutoReplySweeper(supabase)` → `startAutoReplySweeper(supabase, { whatsappSender: (to, text) => client.sendMessage(to, text) })` |

### Behaviour added

- **`isLidAddress(phone)`** — pure predicate; returns `true` if the address contains `@lid`. The single place to update if wwebjs ever changes its suffix convention.
- **`makeDispatch(whatsappSender, standardDispatch)`** — factory that returns a hybrid dispatch function. Logic:
  - If `whatsappSender` is provided AND `profile.phone` is an `@lid` address → calls `whatsappSender(phone, text)`; returns `{ dispatched: true, channel: 'whatsapp', via: 'wwebjs' }` on success, `{ dispatched: false, error }` on throw.
  - Otherwise → falls through to `standardDispatch` (defaults to `dispatchOutreachMessage` from `outbox.js`). Existing behaviour unchanged.
- **`startAutoReplySweeper`** now accepts an optional `{ whatsappSender }`. When omitted, behaviour is identical to before (no regression). When provided, the sweeper uses `makeDispatch` to route `@lid` targets through the wwebjs client.
- `server.js` wires the live `client.sendMessage` as `whatsappSender` via a closure, so the reference is resolved at call-time (after wwebjs `ready`).

### Test count

| | Tests | Files |
|---|---|---|
| Before | 279 | 26 |
| After | **287** | 26 |

All 287 passing.

### Risks and follow-ups

1. **wwebjs not ready at first sweep** — if the wwebjs `ready` event hasn't fired by the time the first 60-second tick runs, `client.sendMessage` throws. The sweeper's catch block handles this: the lead stays `scheduled` and retries on the next tick. No data loss.
2. **`@lid` check is string-contains** — `isLidAddress` uses `phone.includes('@lid')`. Correct for all known wwebjs device IDs; will not false-positive on E.164 numbers.
3. **Meta-path leads are unaffected** — a MEDIUM lead that arrived via the Meta webhook will have a phone number in E.164 format, not `@lid`. Those correctly fall through to `dispatchOutreachMessage` as before.
4. **Single-process assumption unchanged** — the sweeper still runs in-process. Multi-instance safety is tracked in the security backlog.
