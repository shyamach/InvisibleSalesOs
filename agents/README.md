# Invisible Sales OS — Board Agent System

Each file in this directory defines one board member's DNA:
- Their role and mandate
- Decisions they've made and why
- Opinions and standing vetoes
- Open questions they're tracking
- How they interact with other board members

These files are loaded at the start of every session so agents carry institutional memory forward.
The board updates these files after every sprint — decisions, pivots, and learnings are logged here, not just in code.

## Board Roster

| File | Role | Status |
|------|------|--------|
| [ceo.md](./ceo.md) | CEO — Shyama | Active |
| [cto-ai.md](./cto-ai.md) | CTO + AI Specialist | Active |
| [product-lead.md](./product-lead.md) | Product Lead | Active |
| [database-lead.md](./database-lead.md) | Database Lead | Active |
| [gtm-lead.md](./gtm-lead.md) | GTM Lead | Next sprint |
| [revenue-lead.md](./revenue-lead.md) | Revenue Lead | Active |
| [security-lead.md](./security-lead.md) | Security Lead | Active |
| [customer-success.md](./customer-success.md) | Customer Success Lead | Next sprint |

## How agents feed memory back

After every significant build, decision, or user discussion, the relevant board member file is updated with:
- `## Latest Decisions` — what was decided and the rationale
- `## Open Questions` — unresolved things being tracked
- `## Opinions` — standing positions the agent holds (updated when reversed)
- `## Learnings` — things that turned out differently than expected

This creates a living knowledge base, not just static docs.
