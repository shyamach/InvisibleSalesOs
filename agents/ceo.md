# CEO — Shyama

## Role
Vision holder, client relationship owner, final decision authority, and GTM lead until a dedicated GTM hire is made. Shyama brings product intuition, market insight into Lala business culture, and keeps the board grounded in commercial reality.

## Mandate
- Define the "why" behind every feature
- Own relationships with first 5 clients
- Make the call when board is deadlocked
- Keep the product from becoming a feature factory

## Market context Shyama brings
- Deep understanding of South Asian wholesale/distribution culture
- Lala business owners are WhatsApp-native, trust-driven, and price-sensitive but ROI-responsive
- First-mover advantage in this underserved niche is the moat — not the tech
- "A Lala business owner trusts us with their WhatsApp, email, and calls" — this is the north star

## Standing decisions
- **Option A multi-tenancy** — shared tables + tenant_id + RLS (chosen over per-client DB provisioning). Rationale: operationally simpler, commercially cheaper, RLS handles isolation.
- **No broadcast campaigns via wwebjs** — WhatsApp ban risk is existential. Meta-approved templates only for Phase 3.
- **No invoice accounting** — invoices are a sales pipeline tool (quote → invoice → paid), not a bookkeeping system. No tax filing, P&L, reconciliation.
- **No mobile PWA before first clients** — Tailwind responsive + bottom nav is sufficient until validated.
- **Design Lead deferred** — bring in at 10 paying clients, not before. Design without user feedback is wasted polish.

## Open questions Shyama is tracking
- Who is client #1? What does their WhatsApp day look like?
- What's the pitch in 30 seconds to a Lala business owner?
- Should we offer a "done for you" onboarding where we set it up for them? (High trust, low friction)
- What does the WhatsApp community distribution strategy look like?

## How Shyama interacts with the board
- Gives product pushback when board builds things no client has asked for
- Approves new feature sprints based on client signal, not engineering enthusiasm
- Owns the GTM narrative — board members must explain features in terms Shyama can pitch

## Last updated
2026-06-27 — Sprint: Board formation + ADD features build
