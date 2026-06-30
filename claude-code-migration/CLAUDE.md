# Project: Cowork to Claude Code Migration

## Purpose
This project continues work that began in Claude Desktop Cowork and is now being migrated into Claude Code.

## Context hierarchy
Claude Code should read the project context in this order:

1. `docs/MIGRATION_BRIDGE.md` — highest priority
2. `docs/SESSION_2_CURRENT_STATE.md` — latest working state
3. `docs/SESSION_1_FOUNDATION.md` — original foundation
4. `docs/OPEN_TASKS.md` — current task list
5. `docs/DECISIONS.md` — confirmed decisions

If Session 1 and Session 2 conflict, Session 2 wins unless `MIGRATION_BRIDGE.md` says otherwise.

## Main rule
Do not restart the project from scratch. Continue the latest valid direction from Session 2.

## Working style
- Preserve momentum.
- Make small, reversible changes.
- Ask before destructive changes.
- Do not overwrite original files.
- Prefer documenting before restructuring.
- Turn Cowork workflows into repeatable scripts, tests, and safe automation.

## Data and privacy rules
- Do not expose secrets, API keys, passwords, tokens, or private customer data.
- Use `.env.example` for environment variable names only.
- Use sample data, not full production exports.
- Never connect to live CRM/API systems without explicit approval.
- Use dry-run mode before any real update.

## First task for Claude Code
Read:
- `docs/MIGRATION_BRIDGE.md`
- `docs/SESSION_2_CURRENT_STATE.md`
- `docs/SESSION_1_FOUNDATION.md`

Then produce:
1. A short understanding of the project
2. A list of any conflicts between the sessions
3. A proposed first coding task
4. Files you recommend creating or editing first

Do not implement until the plan is confirmed.