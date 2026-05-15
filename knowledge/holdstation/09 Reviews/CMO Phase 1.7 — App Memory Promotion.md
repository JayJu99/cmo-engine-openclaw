# CMO Phase 1.7 — App Memory Promotion

## Goal
Make App Memory useful without moving into Phase 2. Phase 1.7 adds direct editing for core app memory notes and a controlled promotion workflow from recent CMO sessions, saved session notes, raw captures, and daily notes into durable draft app memory.

## Routes / APIs Added
- `GET /api/apps/[appId]/memory`
- `GET /api/apps/[appId]/memory/[noteKey]`
- `PATCH /api/apps/[appId]/memory/[noteKey]`
- `GET /api/apps/[appId]/promotion-candidates`
- `POST /api/apps/[appId]/promotions`

## Vault Paths Touched
- `knowledge/holdstation/02 Apps/World Mini App/Holdstation Mini App/Positioning.md`
- `knowledge/holdstation/02 Apps/World Mini App/Holdstation Mini App/Learnings.md`
- `knowledge/holdstation/02 Apps/World Mini App/Holdstation Mini App/Sessions/2026-05-14 - Phase 1.7 verification session.md`
- `knowledge/holdstation/06 Journal/Raw/2026-05-14.md`
- `knowledge/holdstation/09 Reviews/CMO Phase 1 — App Workspace Milestone.md`
- `knowledge/holdstation/09 Reviews/CMO Phase 1.7 — App Memory Promotion.md`

## Promotion Workflow
1. User runs a CMO session using selected context only.
2. User saves the session to the app Vault and can capture it to Raw Vault.
3. Promotion Candidates are generated deterministically from recent sessions, saved session paths, raw captures, and the daily note.
4. User chooses a target app memory note and clicks Promote to App Memory.
5. The API appends a dated draft section with source link and evidence/context.
6. Target note status becomes `draft`, never `confirmed`.

## Safety Rules
- App IDs are resolved from the known workspace registry.
- App memory note keys use a fixed allowlist.
- Writes only target configured app note paths under `knowledge/holdstation`.
- Promotions append to target notes and verify readback before returning success.
- Editor writes preserve frontmatter and use note hashes to reject stale saves.
- Decision promotions create decision candidates only; no locked decisions.
- Task promotions create task candidates only; no Task Tracker item is created.
- Runtime status remains honest and unchanged: `configured_but_unreachable`.

## Manual Test Results
- Priority flow: existing active priority saved and read back as `Test P1.6`; workspace/dashboard readback matched.
- App Memory edit: `Positioning.md` changed from `placeholder` to `draft`; write/readback verified by hash and content.
- Context quality: App Memory counts updated to 1 draft / 6 needs content after edit, then 2 draft / 5 needs content after promotion. Selected Context shows Positioning and Learnings as draft.
- CMO session: Phase 1.7 verification session returned honest fallback with `runtimeStatus=configured_but_unreachable`.
- Save Session: saved to `02 Apps/World Mini App/Holdstation Mini App/Sessions/2026-05-14 - Phase 1.7 verification session.md`.
- Raw Capture: appended to `06 Journal/Raw/2026-05-14.md`.
- Promotion: promoted the saved Phase 1.7 session candidate into `Learnings.md`; source link exists and candidate status reads back as promoted.
- Safety: invalid note key, invalid target note key, and absolute source path requests were rejected with 400 responses.
- Unchanged pages: `/`, `/apps`, `/daily`, and `/vault` returned 200.
- Browser smoke: `/apps/holdstation-mini-app?tab=inputs` rendered App Memory actions in the existing workspace UI.
- Verification: `npm run lint`, `npm run adapter:build`, and `npm run build` passed.

## Remaining Blockers
- Runtime remains `configured_but_unreachable`, so CMO answers still use honest fallback.
- No Phase 2 decision locking is implemented.
- Task Tracker is not connected; task promotions remain candidates only.
- Promotion extraction is deterministic, not AI-ranked.
- App Memory is app-scoped selected context, not all-vault automatic RAG.
