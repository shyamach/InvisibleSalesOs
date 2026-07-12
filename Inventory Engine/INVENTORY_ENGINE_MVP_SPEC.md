# Inventory Engine MVP — Product Specification

**Status:** Draft for founder review — not yet built, not yet validated with a paying client.
**Author:** Drafted by Claude (Sonnet 5) with Shyama, 2026-07-10.
**Scope:** Documentation only. No code, no migrations, no changes to the existing Invisible Sales OS (ISOS) build order or Block 0 work.

---

## 1. Title and Purpose

**Inventory Engine MVP** — a standalone, fast-to-ship inventory truth system for wholesale/distribution and manufacturing SMEs, built so that it can later slot into Invisible Sales OS as the **Inventory Engine foundation module**.

Purpose of this document: define what the MVP is, why it exists, what it must do, what it explicitly will not do yet, and how it should be architected so today's shortcuts don't become tomorrow's rewrite.

---

## 2. Product Thesis

Traditional wholesale/manufacturing SMEs don't lose money because they reply to customers slowly. They lose money because **nobody in the business can answer "how much do we actually have, right now?"** with confidence. Stock lives in a salesman's head, a WhatsApp photo, a Tally entry three days stale, and a physical count that happened last Monday. Every commercial decision — quote, promise, dispatch, reorder — is built on that shaky number.

**Thesis:** Before you can build an AI that decides "can we sell this, at this price, to this customer, safely" (the ISOS vision), the business needs a system of record for "what do we have" that is trustworthy, event-sourced, and auditable. Inventory truth is the foundation the decision engine sits on — not a side feature.

Build that foundation first, as a lean, sellable product on its own. Layer the decision-engine intelligence on top later.

---

## 3. Relationship to Invisible Sales OS

This is **not a pivot away from ISOS**. It's a foundation block that ISOS's stock-checking logic currently assumes exists but doesn't yet have in a rigorous form.

| | Invisible Sales OS (current) | Inventory Engine (this spec) |
|---|---|---|
| Core loop | Ingest lead → triage → draft → approve/send → escalate | Record inventory action → event → ledger → derived views |
| Primary user | Business owner managing inbound sales conversations | Owner + salesman + inventory staff managing stock |
| Data it needs | Stock levels, price, customer history | SKU truth, movement history, audit trail |
| Maturity | Working build, 300+ tests, pre-launch (see internal stack/architecture notes) | Not started — this is the spec |

**Design intent:** one core codebase, not two products glued together later. The event-driven architecture described here (Section 22) is deliberately the same shape ISOS's own event/action pipeline should eventually use, so that when the Inventory Engine is proven, it merges in as a subsystem rather than requiring a rewrite. Concretely: ISOS's existing catalogue/stock ledger tables and webhook-ingestion pattern are the nearest current analogues — this spec should be read as "how would we rebuild that subsystem properly, event-sourced," not as an unrelated greenfield system.

This spec does **not** change ISOS's current Block-by-block build order (see the Block-by-block architecture decision notes / Block 0 data-safety work in progress). It is a parallel exploration track.

**Build-timing gate (non-negotiable):** Sprint 0 of the Inventory Engine must not start inside the main ISOS repository until Block 0 (the data-safety net) has closed. If Shyama chooses to prototype earlier than that, it must be explicitly framed and built as a **sandbox/mock track** — a separate, disposable environment that cannot connect to or touch production tenant data under any circumstance. This holds regardless of how ready this spec looks on paper.

---

## 4. Target Customer / ICP

**Primary ICP for the MVP:** Small-to-mid traditional manufacturers and wholesalers in India (starting point: textile/clothing manufacturing, Surat) with:

- ₹20–50 crore annual turnover
- 1,000–1,500+ SKU variations (design × colour × size × style)
- No barcode or tagging infrastructure
- Stock tracked manually — salesman headcount, Tally, Excel, WhatsApp photos, pen and paper
- Broker-led B2B order flow, with owner-only negotiation on high-value/relationship accounts
- Partial fulfilment as a routine, not an exception
- Long payment cycles (90–120 days) with real defaulter/reputation risk
- Willing to pay a modest monthly fee (₹2,000–5,000/month range, hypothesis) if setup and training support is included

This is a materially different buyer from ISOS's original "Lala wholesale/distribution, WhatsApp-inbox-first" persona (see the project overview notes) — closer, but focused on **stock operations** rather than **sales conversation** operations. Same broad market (South Asian-run trading/manufacturing SMEs), different entry wedge.

---

## 5. Discovery Evidence (Textile Manufacturer Interview, Surat)

Findings from a direct conversation with a traditional clothing/textile manufacturer, used as the founding evidence for this spec:

- Turnover ₹20–50cr, no functioning digital inventory system despite significant scale.
- 1,000–1,500+ SKU variants across design, colour, size, and style — far beyond what memory or a flat spreadsheet can track reliably.
- Zero barcode/QR tagging on physical stock. All counting is manual, done by salesmen walking the floor.
- Systems in active use: Tally (accounting, not real-time stock), Excel (ad hoc), WhatsApp (photos and text updates), pen and paper (floor counts).
- Partial fulfilment is normal, not exceptional — orders routinely ship in pieces as stock becomes available.
- Orders are broker-led for standard B2B volume; the owner personally negotiates only high-AOV or long-standing relationship accounts.
- Payment recovery routinely takes 90–120 days; late/defaulting customers carry real reputational and cash-flow risk for the business.
- Despite low digital maturity, there is **explicit willingness to pay** for a low-cost, supported solution — ballpark ₹2,000–5,000/month — provided it comes with setup and training help, not a self-serve SaaS drop.

**Caveat:** This is a single interview, not a validated multi-account pattern. Treat every number above (price band, SKU count, willingness to pay) as a hypothesis to test with 2-3 more prospects before committing engineering time past the MVP. See Section 28 (Open Questions).

---

## 6. Core Problem Statement

> **These businesses cannot answer "how much stock do we have, right now, for this specific SKU" with confidence — and every downstream commercial decision (quoting, promising, dispatching, reordering, collecting payment) inherits that uncertainty.**

The problem is not a lack of AI. It's a lack of a trustworthy, timely, auditable record of stock state and stock movement, at the SKU-variant level, that multiple people (owner, salesman, inventory staff) can rely on and update without overwriting each other or losing history.

---

## 7. MVP Goals

1. Give the business **one place** to see current stock, per SKU, that is more trustworthy than Tally/Excel/WhatsApp combined.
2. Make every stock change an **explicit, attributable, timestamped event** — never a silent overwrite.
3. Prevent the most costly failure mode: **overselling stock that isn't there**.
4. Support **partial fulfilment** as a first-class workflow, not a workaround.
5. Give the owner a **dashboard and a handful of reports** that answer the questions they currently ask a salesman over the phone.
6. Architect the event pipeline so it is **extendable** — reporting, alerting, and AI/forecasting can all subscribe to the same event stream later without re-architecting.
7. Ship something a real textile manufacturer can use within weeks, not a platform.

---

## 8. Non-Goals / Out of Scope (MVP)

Explicitly **not** in this MVP:

- Barcode/QR scanning hardware or workflows (may come later — see Section 28).
- Tally/accounting system integration or sync.
- Multi-warehouse / multi-location inventory (single location assumed for MVP).
- Purchase order management, supplier management, or procurement workflows.
- Invoicing, billing, or payment tracking (that's ISOS's existing domain).
- AI/forecasting features of any kind (see Section 20 — deliberately deferred).
- Mobile native app (responsive web is sufficient for MVP).
- Multi-tenant SaaS polish (single-client pilot first, multi-tenant hardening after).
- Industry packs beyond textile (electronics, food, drinks, toys are named in the roadmap but not built now).

---

## 9. Core Concepts

| Concept | Definition |
|---|---|
| **SKU** | A uniquely identifiable stock-keeping unit — for textile, the combination of design, colour, size, and style (see Section 10). |
| **Inventory event** | An immutable record of something that happened to stock (created, added, sold, reserved, adjusted, etc.). The atomic unit of truth. |
| **FIFO queue** | The ordered **delivery/processing mechanism** that already-durable inventory events are published to, so consumers receive them in the order they were accepted. It is a transport mechanism, not a store of truth — see "Important" note below. |
| **Inventory ledger** | The append-only, ordered log of all inventory events (`inventory_events`). The **sole source of truth**; current stock, projections, and reports are all *derived* from it by replay, never the other way around. |
| **Current stock** | The physical quantity on hand for a SKU, computed by replaying/aggregating its ledger events. |
| **Reserved stock** | Quantity earmarked against a pending order but not yet shipped/deducted from current stock. |
| **Available stock** | `current stock − reserved stock`. The number that governs whether a new sale can be accepted. |
| **Pending production** | Quantity that has been marked as "being made" but is not yet physically in stock. |
| **Pending fulfilment** | Quantity owed to a customer from a partially-fulfilled order, not yet shipped. |
| **Movement history** | The human-readable timeline of stock changes for a SKU, derived from the ledger. |
| **Audit trail** | Who did what, when, and why — particularly for manual adjustments, which always require a reason. |

**Important architectural note — queue vs. ledger:** `inventory_events` is the durable, append-only ledger and the only source of truth. The FIFO queue/stream is purely the delivery mechanism that carries an already-durable event to its consumers (inventory, reporting, alert listeners) in order — it must never be the only place an event exists, and it is never authoritative on its own. An event only counts as "accepted" once it is durably written to `inventory_events`; the queue's job is guaranteed, ordered delivery of that write, not durability itself. Every projection and report (Sections 15, 19) must be **rebuildable from a full replay of `inventory_events` alone** — if a projection and the ledger ever disagree, the ledger wins and the projection is rebuilt, never the reverse. A crash, restart, or consumer failure must never silently drop an inventory event. This holds from MVP mock through production (Sections 21–22).

---

## 10. Textile-Specific SKU Model

For the MVP's target vertical (textile/clothing manufacturing), a SKU is defined by:

| Field | Type | Required | Notes |
|---|---|---|---|
| `product_name` | string | yes | e.g. "Cotton Kurti" |
| `design_code` | string | yes | Internal design identifier, e.g. "DK-2231" |
| `colour` | string | yes | e.g. "Maroon" |
| `size` | string | yes | e.g. "M", "L", "42" |
| `style_category` | string | yes | e.g. "Kurti", "Saree", "Fabric Roll" |
| `image_url` | string | no | Optional reference photo |
| `low_stock_threshold` | integer | yes | Per-SKU reorder trigger point |

The **SKU identity** is the combination `(product_name, design_code, colour, size, style_category)`. Each unique combination is tracked as its own row in `inventory_items` with its own event history.

This model is intentionally a config, not hardcoded schema — other verticals (electronics: brand × model × variant; food: batch × expiry) plug in different attribute sets against the same event/ledger core. See Section 27 (development philosophy note carried from the brief).

---

## 11. User Roles

For MVP, active roles are reduced to two — enough for a single pilot client without adding permission complexity before it's needed:

| Role | Description |
|---|---|
| **Owner/Admin** | Full authority — the business owner and/or the inventory staff they delegate to. Combines the original "Owner" and "Inventory/Admin staff" concepts into one role for MVP. |
| **Salesman** | Sells stock, reserves stock against pending orders, submits floor counts. |

**Viewer** (read-only access for e.g. an accountant or broker) is **post-MVP** — deferred until a pilot client actually asks for it (see Section 28).

**Role → action enforcement mapping (MVP):**

| Action | Owner/Admin | Salesman |
|---|---|---|
| Create SKU | ✅ | ❌ |
| Add stock | ✅ | ❌ |
| Sell stock | ✅ | ✅ |
| Reserve stock | ✅ | ✅ |
| Release reservation | ✅ | ✅ |
| Adjust stock (requires reason) | ✅ | ❌ |
| View dashboard/reports | ✅ | ✅ |

Role enforcement is a backend concern, **checked server-side against this mapping before an action is validated** (Section 12, Section 16) — never assumed to be handled by frontend UI hiding alone. This table is the concrete mechanism, not just an assertion.

---

## 12. Core Inventory Actions

1. **Create SKU** — register a new SKU with attributes and opening stock (may be zero).
2. **Add stock** — increase current stock (new production, purchase, return-to-stock).
3. **Sell stock** — decrease current stock (or available stock, if reserved) against a sale.
4. **Reserve stock** — earmark quantity against a pending order without deducting current stock.
5. **Release reservation** — cancel a reservation, returning quantity to available stock.
6. **Adjust stock** — manual correction (count mismatch, damage, loss) — always requires a reason.
7. **Return stock** — customer return, increases current stock.
8. **Mark production pending** *(post-validation — see Section 28; not required for the first pilot demo unless confirmed with the client)* — flag quantity as being manufactured, not yet on hand.
9. **Mark production completed** *(post-validation — see Section 28)* — convert pending production into current stock.
10. **Partial fulfilment** — ship less than the full ordered quantity, explicitly tracking what remains owed.

---

## 13. Event Types

| Event | Triggered by | Effect on ledger |
|---|---|---|
| `STOCK_CREATED` | Create SKU | Establishes SKU + opening balance |
| `STOCK_ADDED` | Add stock | +current stock |
| `STOCK_SOLD` | Sell stock | −current stock (and −reserved if applicable) |
| `STOCK_RESERVED` | Reserve stock | +reserved stock |
| `STOCK_RESERVATION_RELEASED` | Release reservation | −reserved stock |
| `STOCK_ADJUSTED` | Manual adjustment | ± current stock, requires `reason` |
| `STOCK_RETURNED` | Customer return | +current stock |
| `PRODUCTION_MARKED_PENDING` | Mark production pending | +pending production |
| `PRODUCTION_COMPLETED` | Mark production completed | −pending production, +current stock |
| `ORDER_PARTIALLY_FULFILLED` | Partial fulfilment | −current stock (fulfilled qty), +pending fulfilment (remainder) |
| `ORDER_CANCELLED` | Order cancellation | −reserved / −pending fulfilment, no stock effect if unfulfilled |

Every event, regardless of type, carries a common envelope: `event_id`, `event_type`, `sku_id`, `tenant_id`, `actor_id`, `timestamp`, `payload`, `idempotency_key`. `sequence_no` is deliberately not part of the client-submitted envelope — it is assigned by the backend at write time (Section 15/16) and only exists once the event is durably recorded.

*Note: `PRODUCTION_MARKED_PENDING` and `PRODUCTION_COMPLETED` are specified here for completeness but are deferred from Sprint 0–2, pending validation with additional pilot prospects (Section 28). `ORDER_PARTIALLY_FULFILLED` is the validated workflow and remains in MVP scope.*

---

## 14. Event Payload Examples (JSON)

*Note: the `idempotency_key` values below are illustrative. In practice the key is constructed and validated server-side (e.g. derived from tenant, action type, and a client-supplied request token) — never accepted as an arbitrary client string. `sequence_no` does not appear in these examples because it is assigned by the backend after the event is durably written, not submitted by the caller (see Section 13, 15, 16).*

**`STOCK_ADDED`**
```json
{
  "event_id": "evt_9f1c2a",
  "event_type": "STOCK_ADDED",
  "sku_id": "sku_dk2231_maroon_m",
  "tenant_id": "client_surat_textile_01",
  "actor_id": "user_inventory_staff_04",
  "timestamp": "2026-07-10T09:14:00Z",
  "idempotency_key": "add_2026-07-10T09:14:00Z_dk2231_maroon_m_120",
  "payload": {
    "quantity": 120,
    "source": "production_batch",
    "batch_ref": "PB-2026-0710-03"
  }
}
```

**`STOCK_SOLD`**
```json
{
  "event_id": "evt_9f1c2b",
  "event_type": "STOCK_SOLD",
  "sku_id": "sku_dk2231_maroon_m",
  "tenant_id": "client_surat_textile_01",
  "actor_id": "user_salesman_11",
  "timestamp": "2026-07-10T11:02:00Z",
  "idempotency_key": "sell_order_5521_line_1",
  "payload": {
    "quantity": 40,
    "order_ref": "ORD-5521",
    "customer_ref": "cust_broker_9",
    "unit_price": 310.00
  }
}
```

**`STOCK_ADJUSTED`**
```json
{
  "event_id": "evt_9f1c2c",
  "event_type": "STOCK_ADJUSTED",
  "sku_id": "sku_dk2231_maroon_m",
  "tenant_id": "client_surat_textile_01",
  "actor_id": "user_owner_01",
  "timestamp": "2026-07-10T18:30:00Z",
  "idempotency_key": "adjust_2026-07-10_dk2231_maroon_m_recount",
  "payload": {
    "quantity_delta": -6,
    "reason": "Physical recount found 6 pieces short — likely floor damage",
    "counted_by": "user_salesman_11"
  }
}
```

**`ORDER_PARTIALLY_FULFILLED`**
```json
{
  "event_id": "evt_9f1c2d",
  "event_type": "ORDER_PARTIALLY_FULFILLED",
  "sku_id": "sku_dk2231_maroon_m",
  "tenant_id": "client_surat_textile_01",
  "actor_id": "user_inventory_staff_04",
  "timestamp": "2026-07-11T10:00:00Z",
  "idempotency_key": "fulfil_order_5521_partial_1",
  "payload": {
    "order_ref": "ORD-5521",
    "ordered_quantity": 100,
    "fulfilled_quantity": 60,
    "remaining_quantity": 40,
    "reason": "Remaining 40 pending next production run"
  }
}
```

---

## 15. Data Model Proposal (Mock DB)

Table-level proposal — deliberately simple for MVP, extensible for production (Section 22).

**`inventory_items`**
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | client scoping |
| product_name, design_code, colour, size, style_category | text | SKU identity fields |
| image_url | text | nullable |
| low_stock_threshold | integer | |
| created_at | timestamp | |

**`inventory_events`** (the ledger — append-only)
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| sku_id | uuid | FK → inventory_items |
| tenant_id | uuid | |
| event_type | text | enum, Section 13 |
| actor_id | uuid | who triggered it |
| payload | jsonb | event-specific data |
| idempotency_key | text | server-generated/validated, never trusted verbatim from the client; enforced via `UNIQUE (tenant_id, idempotency_key)` |
| sequence_no | bigint | **server-assigned**, atomically incremented per `(tenant_id, sku_id)` at write time — never accepted from the client; enforces FIFO replay per tenant + SKU, not globally |
| created_at | timestamp | |

**`inventory_stock_projection`** (derived/materialized view, or a projection table for fast reads — deliberately **not** named `stock_movements` to avoid colliding with ISOS's existing `stock_movements` ledger table; this is a distinct, Inventory-Engine-specific derived view, not the existing ISOS stock ledger)
| Column | Type | Notes |
|---|---|---|
| tenant_id | uuid | client scoping |
| sku_id | uuid | |
| current_stock | integer | |
| reserved_stock | integer | |
| available_stock | integer | computed: current − reserved |
| pending_production | integer | |
| pending_fulfilment | integer | |
| last_event_id | uuid | last event folded into this projection |
| updated_at | timestamp | |

**`pending_fulfilments`**
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | client scoping |
| order_ref | text | |
| sku_id | uuid | |
| ordered_quantity | integer | |
| fulfilled_quantity | integer | |
| remaining_quantity | integer | |
| status | text | open / closed / cancelled |

**`users` / actors**
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | |
| name | text | |
| role | text | owner / salesman / inventory_admin / viewer |

**`failed_events`** (dead-letter — see Section 16)
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | client scoping |
| original_event | jsonb | full payload that failed |
| error_reason | text | |
| failed_at | timestamp | |
| retry_count | integer | |

**Tenant scoping — no exceptions:** every table above carries `tenant_id`, including the derived projection and the failed-event/dead-letter table. This is a hard requirement, not a nice-to-have: it is what makes real RLS possible later without an invasive migration (see Section 22), and it directly avoids repeating the gap already flagged in the Block 1.4 RLS audit (tables without `tenant_id` from day one).

**Derived/reporting views:** low-stock and recent-movements/adjustment reports (Section 19 MVP reports) can be built as SQL views or materialized views over `inventory_events` + `inventory_stock_projection` rather than separate tables — avoids duplicating logic in two places. Post-MVP reports (fast-moving, dead-stock, pending production, salesman activity) follow the same pattern once built.

**Constraints and backstops (mock and production):**

| Constraint | Purpose |
|---|---|
| `UNIQUE (tenant_id, product_name, design_code, colour, size, style_category)` on `inventory_items` | No duplicate SKU identity within a tenant. |
| `UNIQUE (tenant_id, sku_id, sequence_no)` on `inventory_events` | Enforces FIFO integrity per tenant + SKU at the database level, not just by convention. |
| `UNIQUE (tenant_id, idempotency_key)` on `inventory_events` | Enforces idempotent processing at the database level — a duplicate key cannot be written twice. |
| `CHECK (quantity > 0)` on any quantity field driving a stock change | Recommend promoting `quantity` and `reason` from inside the `payload` jsonb column to dedicated typed columns on `inventory_events` specifically so this — and the rule below — can be real CHECK/NOT NULL constraints, not just application-layer validation. |
| Non-empty `reason` required on `STOCK_ADJUSTED` | Same recommendation as above — a dedicated `reason` column with `NOT NULL` (conditional on event type) is stronger than jsonb-only validation. |
| `CHECK (available_stock >= 0)` on `inventory_stock_projection` | Available stock must never go negative unless a future, explicit backorder/negative-stock policy is introduced — no such policy exists in this MVP. |

The mock build may waive the CHECK-constraint-level enforcement above in favour of application-layer validation only, but any such gap must be documented as a known gap, not silently assumed away — see Section 30.

---

## 16. Business Rules

1. **Do not sell more than available stock.** A `STOCK_SOLD` event that would drive available stock negative must be rejected at validation, before it enters the queue.
2. **Partial fulfilment must be explicit.** The system never silently "closes" an order at less than the ordered quantity — a `remaining_quantity` > 0 always creates/updates a `pending_fulfilments` row.
3. **Manual adjustment requires a reason.** `STOCK_ADJUSTED` events with an empty/missing `reason` field are rejected at the API layer.
4. **Event processing must be idempotent.** `idempotency_key` is generated and validated server-side, must be unique per tenant, and is enforced via a database unique constraint on `(tenant_id, idempotency_key)` (Section 15). Replaying the same event — a network retry, a queue redelivery, or a duplicate consumer run — must not apply stock changes twice; a duplicate key for the same tenant is a no-op, logged but not reprocessed.
5. **FIFO ordering matters per tenant + SKU, not globally.** `sequence_no` is assigned by the backend, atomically, per `(tenant_id, sku_id)` at the moment an event is durably written — the client never supplies it. Events for the same tenant + SKU must be applied in that order, even if consumers process at different speeds; ordering across different SKUs or different tenants is not guaranteed or required.
6. **Failed events go to a dead-letter log**, never silently disappear. A consumer failure must be visible and retriable, not swallowed.
7. **Projections must be rebuildable by full replay.** `inventory_stock_projection` and all reports (Section 19) can always be regenerated from `inventory_events` alone; if a projection and the ledger disagree, the ledger is authoritative and the projection is rebuilt, never edited directly.

---

## 17. Main User Flows

**Add SKU**
Owner/staff → fill SKU form (product, design, colour, size, style, threshold, opening stock) → validate uniqueness → `STOCK_CREATED` event → ledger + projection updated → SKU appears in dashboard.

**Add stock**
Staff → select SKU → enter quantity + source → `STOCK_ADDED` event → current stock increases → movement history updated.

**Sell stock**
Salesman → select SKU → enter quantity + order ref → backend checks available stock → if sufficient: `STOCK_SOLD` event, else: rejected with clear error ("only 40 available, 100 requested").

**Partial fulfilment**
Staff → open order → ship what's available → `ORDER_PARTIALLY_FULFILLED` event with fulfilled + remaining quantities → `pending_fulfilments` row created/updated → remainder resolved later via a follow-up fulfilment event.

**Manual stock adjustment**
Staff/owner → select SKU → enter delta + mandatory reason → `STOCK_ADJUSTED` event → audit trail entry created, visible in adjustment report.

**Reserve/release stock**
Salesman → reserve quantity against a pending order → `STOCK_RESERVED` → available stock drops without touching current stock. If order falls through → `STOCK_RESERVATION_RELEASED` → available stock restored.

**Production completed** *(deferred — post-validation, see Section 28)*
Staff → mark a pending production batch complete → `PRODUCTION_COMPLETED` event → pending production decreases, current stock increases by the completed quantity.

---

## 18. Dashboard Requirements

The owner's home screen must show, at a glance:

- Total SKUs (active count)
- Low stock (SKUs at/below `low_stock_threshold`)
- Out of stock (available stock = 0)
- Stock added today (units, across SKUs)
- Stock sold today (units, across SKUs)
- Pending fulfilment (open orders count + total units owed)
- Pending production (batches + total units in progress) *(post-validation — see Section 28; omit from the Sprint 0–2 dashboard if the production lifecycle stays deferred)*
- Recent movements (last N events, human-readable feed)

---

## 19. Reports

**MVP reports (Sprint 0–2):**

| Report | Purpose |
|---|---|
| Stock in hand | Full current-stock snapshot across all SKUs |
| Low-stock report | SKUs at/below threshold, sorted by urgency |
| Recent movements / adjustment log | Chronological feed of stock events, including manual adjustments with their reasons — covers movement history and audit visibility in one view |

**Post-MVP reports** (build after the mock MVP is validated with a pilot client):

| Report | Purpose |
|---|---|
| Fast-moving SKU report | Highest sell-through over a period (reorder signal) |
| Dead-stock / no-movement report | SKUs with no sale/movement in N days (capital stuck) |
| Pending production report | What's in progress, expected completion — depends on the production pending/completed workflow being validated (Section 28) |
| Salesman activity report | Who sold/reserved/counted what, and when |

---

## 20. AI Scope

**Explicitly not core to the MVP.** The MVP's entire value proposition is a trustworthy structured record — AI has nothing reliable to reason over until that exists.

**Future AI** (post-MVP, once the event ledger has real history) reads structured events only — it does not get special write access or bypass the validation/business-rules layer. Candidate future features:

- Demand forecasting per SKU
- Low-stock prediction (before threshold is hit, based on velocity)
- Dead-stock insight and liquidation suggestions
- Natural-language stock queries ("how much maroon size-M kurti do we have left?")
- Suspicious-adjustment detection (pattern of large manual adjustments by one actor)

This mirrors ISOS's own principle of AI-as-a-consumer-of-structured-data rather than AI-as-the-source-of-truth.

---

## 21. Mock MVP Architecture

Kept deliberately simple to ship fast:

```
[ Frontend (simple web UI) ]
        |
        v
[ Backend API — validates action, enforces business rules ]
        |
        v
[ FIFO event queue (in-memory or lightweight persistent queue) ]
        |
        +--> [ Inventory listener ]   --> updates inventory_stock_projection
        +--> [ Reporting listener ]   --> updates report views
        +--> [ Alert listener ]       --> checks low-stock/unusual movement
        |
        v
[ Mock DB: Postgres — event-sourced ]
```

- **Frontend:** simple forms + dashboard (React/Next.js consistent with ISOS's existing stack, or a minimal standalone build — open question, Section 28).
- **Backend API:** validates every action against business rules (Section 16) *before* publishing to the queue — invalid actions never become events.
- **Mock auth (Sprint 0 requirement, non-negotiable):** `tenant_id` and `actor_id` must always be derived from a signed/mock session (even a minimal signed session token issued at login) — never accepted directly from a frontend request payload or an unauthenticated header. Trusting an `x-tenant-id`-style header, or any `DEV_BYPASS_AUTH`-style flag that skips this derivation, is explicitly prohibited for this system — that is the exact pattern already flagged as a standing security gap elsewhere in ISOS (Section 22), and this spec must not reintroduce it, even temporarily, even in a mock.
- **FIFO queue (MVP):** can be an in-memory ordered queue for a single-process demo, but must still be backed by durable, replayable storage (e.g., an append-only table used as the queue) so a restart doesn't lose unprocessed events — the "not a cache" requirement applies even at mock scale.
- **Mock DB: Postgres, committed from Sprint 0** (local Postgres or a Supabase project — not SQLite or local JSON). Idempotency, per-tenant/per-SKU ordering, tenant isolation, and the constraints in Section 15 are core to what this product promises, and can't be reliably enforced on SQLite/JSON; a pilot client is plausible soon enough that a database swap mid-build is a real risk, not a hypothetical one. This resolves Open Question 1 (Section 28).
- **Event consumers:** inventory, reporting, and alert listeners as independent functions/processes subscribing to the same stream — proves the multi-consumer model works before production hardening.

---

## 22. Production Architecture Direction

Once validated, the production path (not built now, direction only):

- **Supabase/Postgres** as the system of record — consistent with ISOS's existing stack (see internal stack/architecture notes), avoids a second database technology to operate.
- **Event queue/stream:** Upstash Redis Streams (or equivalent — e.g. Postgres `LISTEN/NOTIFY` + an outbox table, or a managed queue) providing durable, ordered, replayable delivery — the FIFO/"not a cache" requirement carried through from MVP.
- **Worker consumers:** inventory, reporting, alert, and (later) AI workers as independently deployable processes, each idempotent against `idempotency_key`.
- **Append-only event ledger:** `inventory_events` never updated or deleted — corrections happen via new compensating events, never edits.
- **Failed events / dead-letter:** a durable `failed_events` log with visibility and manual/automatic retry, not a silent drop.
- **Multi-tenancy:** `tenant_id` on every table and event, RLS-enforced — consistent with ISOS's Supabase RLS approach, and mindful of the current RLS audit findings (Block 1.4, Lane C: any new tables must be designed with a real JWT-based tenant scoping path from day one, not a caller-supplied header). **Production RLS/JWT integration for this module remains blocked on that same unresolved ISOS tenant-scoping/auth work** — this spec does not solve it, and must not be used to justify shipping a temporary header-trust or bypass-auth shortcut to get around the blocker.

---

## 23. Acceptance Criteria

The MVP is "done" when it can demonstrably:

- Create a SKU with full textile attribute set
- Add stock to a SKU
- Sell stock, decrementing available stock correctly
- Adjust stock manually, with a mandatory reason logged
- Reserve stock and release a reservation
- Prevent overselling (reject a sale exceeding available stock)
- Track partial fulfilment against an order, with remaining quantity visible
- Show full movement history for a given SKU
- Process a duplicate event idempotently (no double-counting)
- Process same-SKU events strictly in FIFO order
- Display a correct low-stock report

---

## 24. Test Scenarios

1. Create SKU with opening stock → stock reflects opening quantity.
2. Add stock → current stock increases by exact amount.
3. Sell stock (sufficient available) → succeeds, available stock decreases.
4. Sell stock (insufficient available) → **oversell attempt blocked**, clear rejection reason returned.
5. Partial fulfilment → creates a `pending_fulfilments` record with correct remaining quantity.
6. *(Deferred — post-validation, Section 28)* Production completed → pending production decreases, current stock increases by completed quantity.
7. Reserve stock → available stock decreases, current stock unchanged.
8. Release reservation → available stock restored to pre-reservation level.
9. Adjustment → creates an audit log entry with reason; rejected if reason missing.
10. Duplicate event (same idempotency key) → does not double-count; second attempt is a no-op.
11. Same-tenant, same-SKU events submitted in rapid/overlapping succession → backend assigns `sequence_no` atomically at write time and consumers process them in that server-assigned order, not arrival/receipt order.
12. Low stock alert → triggers when available stock crosses at/below `low_stock_threshold`.

---

## 25. Suggested Build Phases

**Timing gate:** see Section 3 — Sprint 0 does not start in the main ISOS repo until Block 0 closes; earlier prototyping must be sandboxed. **Database:** Postgres from Sprint 0 (Section 21), not SQLite/JSON.

| Sprint | Focus |
|---|---|
| **Sprint 0** | Mock foundation on Postgres — repo scaffold, SKU model, basic CRUD, mock auth (session-derived tenant_id/actor_id), no events yet |
| **Sprint 1** | Event ledger — append-only event table, server-assigned idempotency + sequence numbers, unique constraints (Section 15) |
| **Sprint 2** | Inventory engine — FIFO queue, inventory listener, `inventory_stock_projection`, business rules enforcement, role→action mapping (Section 11) |
| **Sprint 3** | Textile workflows — partial fulfilment, reservations (production pending/completed deferred pending validation — see Section 28) |
| **Sprint 4** | Reporting — dashboard, the 3 MVP reports (Section 19), alert listener |
| **Sprint 5** | Demo polish — UI pass, pilot-client walkthrough readiness, training material draft |

---

## 26. Pricing and GTM Hypothesis

- **Hypothesis only — not validated.** Based on a single interview (Section 5).
- Possible one-time setup/training fee to cover the hands-on onboarding traditional-industry buyers seem to expect.
- Low monthly subscription (₹2,000–5,000/month range) for early pilot clients.
- Likely needs to be **service-assisted SaaS**, not pure self-serve — this buyer segment wants a person to set it up and train the floor staff, not a signup flow. This has real cost/margin implications that revenue-lead should weigh in on before pricing is finalized.

---

## 27. Risks

- **Low tech adoption** — floor staff and salesmen used to pen/paper/WhatsApp may resist a new tool without hands-on training and visible daily benefit.
- **Low willingness to pay** — the ₹2-5k/month figure comes from one conversation, not a signed commitment.
- **Manual data quality** — no barcode means every stock count is still human-entered; garbage in, garbage out, no matter how good the event architecture is.
- **Salesman compliance** — if salesmen don't reliably log sells/counts, the "single source of truth" promise breaks immediately.
- **Barcode absence** — limits how automated stock-taking can become without a hardware investment the client may not want yet.
- **Competing textile ERP tools** (e.g. Vastra App and similar vertical ERPs) — need a clear differentiation story (likely: event-driven truth + eventual AI layer + ISOS ecosystem tie-in, vs. traditional ERP's static reporting).

---

## 28. Open Questions (Need Founder Decision)

1. ~~**Mock DB choice**~~ — **RESOLVED: Postgres from Sprint 0** (Section 21). Idempotency, ordering, tenant isolation, and the constraints in Section 15 are core to the product and can't be reliably guaranteed on SQLite/JSON.
2. **Standalone product vs. ISOS module** — ship and sell this as its own product first, or only ever position it as "part of Invisible Sales OS"?
3. **Barcode/QR timing** — worth prototyping even a lightweight QR-label workflow in the MVP, or strictly manual-entry until a client asks?
4. **Tally integration timing** — is Tally read/export integration a near-term differentiator, or firmly post-MVP?
5. **First vertical confirmation** — is textile/clothing the confirmed first vertical, or still provisional pending more discovery calls?
6. **Pricing validation** — how many more prospect conversations are needed before committing to the ₹2-5k/month band?
7. **Frontend stack** — reuse ISOS's Next.js frontend/shared components, or build a lighter standalone UI for speed?
8. **Ownership/governance** — should this go through the same board-of-agents review (product-lead, database-lead, security-lead) as ISOS features before build starts, given it may become a module? **Answered:** yes — the board review (Section 30) has now happened; this question is closed.
9. **Production pending/completed workflow** — confirm with the pilot client whether this is actually needed as its own tracked lifecycle, or whether add-stock/adjust-stock already cover it in practice. Section 12 items 8–9 are deferred pending this answer.

---

## 29. Conclusion

This MVP should be treated as the **Inventory Engine foundation for Invisible Sales OS** — not a random pivot, and not a permanently separate product built on a permanently separate codebase. The discovery conversation with the Surat textile manufacturer surfaced a real, expensive, currently-unsolved problem (inventory truth) that sits directly underneath ISOS's stated thesis: you can't safely automate commercial decisions on top of stock numbers nobody trusts.

The event-driven architecture proposed here is intentionally shaped so that today's fast MVP shortcuts (in-memory queue, SQLite, single vertical) upgrade cleanly into tomorrow's production system (Redis Streams, Postgres/Supabase, multi-vertical rule packs) without a rewrite — one core codebase, industry rule packs and client configuration on top, as the brief requires.

Nothing here commits engineering time. This is a spec for review.

---

## 30. Board Review Conditions Resolved

A board-style review (Product Lead, CTO/Engineering Lead, Database Lead, Security Lead) was run against the original draft of this spec before Sprint 0. All four roles returned **GO WITH CONDITIONS**, no NO-GOs. This hardening pass resolves the "must change before coding" items raised:

- **Timing/blast-radius:** added an explicit build-timing gate (Section 3) — Sprint 0 doesn't start in the main ISOS repo until Block 0 closes; earlier prototyping must be sandboxed, no production tenant data.
- **Naming collision:** renamed the mock projection table from `stock_movements` to `inventory_stock_projection` throughout (Section 15, 21) to avoid colliding with ISOS's existing `stock_movements` ledger.
- **Queue vs. ledger ambiguity:** clarified that `inventory_events` is the sole source of truth and the FIFO queue is only the delivery mechanism, never authoritative on its own; added a replay-rebuild requirement as Business Rule 7 (Section 9, 16).
- **Mock DB choice:** resolved in favour of Postgres from Sprint 0, not SQLite/JSON (Sections 21, 25, 28).
- **Tenant_id consistency:** added `tenant_id` to every table in Section 15 with no exceptions, including the projection and dead-letter tables.
- **Auth/actor provenance:** added a non-negotiable mock-auth requirement (Section 21) — `tenant_id`/`actor_id` must come from a signed/mock session, never a client payload or header; `x-tenant-id` header trust and `DEV_BYPASS_AUTH`-style flags are explicitly prohibited.
- **Role enforcement:** reduced MVP roles to Owner/Admin and Salesman, with Viewer deferred, and added a concrete role→action mapping table (Section 11) instead of an unenforced assertion.
- **Server-assigned sequencing:** `sequence_no` is now explicitly server-assigned, atomic, per `(tenant_id, sku_id)` — never client-supplied (Sections 13, 15, 16, 24).
- **Deterministic idempotency:** `idempotency_key` is explicitly server-generated/validated, unique per tenant, backed by a `UNIQUE (tenant_id, idempotency_key)` constraint (Sections 14, 15, 16).
- **DB-level backstops:** added a constraints table (Section 15) covering SKU-identity uniqueness, sequence/idempotency uniqueness, quantity/reason checks, and non-negative available stock.
- **Scope cuts:** removed the future AI listener from the mock architecture diagram (Section 21); deferred the production pending/completed workflow pending pilot validation (Sections 12, 13, 17, 18, 24, 25, 28); reduced MVP reports from seven to three, with the rest marked post-MVP (Section 19).

No product strategy, pricing hypothesis, ICP, or non-goals changed in this pass — this was a precision and safety hardening pass only, per all four reviewers' verdicts.

---

## Review Checklist for Shyama

- [ ] Confirm textile/clothing manufacturing is the right first vertical to build for (vs. broader "any SME with inventory").
- [ ] Confirm whether this ships as a standalone product or is only ever framed as an ISOS module.
- [ ] Confirm the ₹2,000–5,000/month price band is worth designing for, or needs more validation first.
- [ ] Confirm the Postgres-from-Sprint-0 decision (Section 21) is acceptable, or flag a reason to reconsider.
- [ ] Confirm the build-timing gate (Section 3) — Sprint 0 does not start in the main ISOS repo until Block 0 closes.
- [ ] Confirm the reduced 2-role model (Owner/Admin, Salesman) for MVP is sufficient, or Viewer is needed sooner than post-MVP.
- [ ] Confirm production pending/completed workflow should stay deferred pending pilot validation, or is already confirmed as needed.
- [ ] Confirm this does not pull engineering attention away from current Block 0 data-safety work.
- [ ] Flag anything in Sections 9–17 (core concepts, SKU model, events, business rules) that doesn't match how the Surat client actually operates, before it hardens into schema.
