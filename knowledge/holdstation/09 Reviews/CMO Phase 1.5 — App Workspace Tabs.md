# CMO Phase 1.5 - App Workspace Tabs

Status: ready for user UI testing

## Goal

Refactor each `/apps/[appId]` workspace into a tab-based operating room while preserving the existing Phase 1 UI theme and honest runtime/Vault boundaries.

## Routes Changed

- `/apps/[appId]`
- `/api/apps/[appId]/workspace`
- `/api/apps/[appId]/priorities`
- `/api/apps/[appId]/sessions`
- `/api/apps/[appId]/plans`
- `/api/apps/[appId]/tasks`
- `/api/cmo/sessions/save-to-vault`
- `/api/vault/raw-captures`

## Tab Structure

- Dashboard: app state, priority, mission, missing metrics placeholder, plan/task/session/recap summaries, CMO readiness.
- Inputs & Priorities: C-Level Priority editor, project doc paths/statuses, context pack selector, app memory quality.
- Plan & Recap: weekly/monthly plan placeholders, latest daily note status, recap placeholders, suggested promotions placeholder.
- Tasks: Task Tracker integration shell and Vault task summary.
- CMO Sessions: session history, selected session metadata/messages, save session to Vault, raw capture, current chat.

## Vault IA Mapping

For each app under `knowledge/holdstation/02 Apps/`, Phase 1.5 ensures:

- `Dashboard.md`
- `C-Level Priorities.md`
- `Inputs/Project Docs.md`
- `Inputs/Meeting Inputs.md`
- `Inputs/Metrics Snapshot.md`
- `Inputs/Uploaded Docs/.gitkeep`
- `Plans/Weekly/.gitkeep`
- `Plans/Monthly/.gitkeep`
- `Recaps/Daily/.gitkeep`
- `Recaps/Weekly/.gitkeep`
- `Recaps/Monthly/.gitkeep`
- `Sessions/.gitkeep`

Existing core notes remain in place. `Tasks.md` was only appended with the Task Tracker source-of-truth clarification when that clarification was missing.

## APIs / Helpers Added

- File-backed C-Level Priority read/save helpers.
- File-backed current weekly/monthly plan read/create helpers.
- App task summary helper returning a clear placeholder when Task Tracker is not connected.
- App session summary helper over `data/cmo-dashboard/app-chat/session_*.json`.
- Save CMO session to Vault helper writing `02 Apps/<App>/Sessions/YYYY-MM-DD - <Topic>.md`.
- Raw capture metadata extension for session id, session note path, related priority, related plan, runtime, fallback, and context quality.

## Remaining Blockers

- OpenClaw runtime is still not verified as connected from this workspace.
- No Task Tracker code, routes, Google Sheets mapping, or Telegram task export was found in this repository.
- Holdstation Mini App memory remains mostly placeholder until supported source material is provided.
- Metrics are not connected and are not invented.
- Phase 2 workflows are intentionally not implemented.

## Verification

- `npm run lint` passed.
- `npm run adapter:build` passed.
- `npm run build` passed.

## Manual Test Steps

1. Open `/` and confirm Command Center renders.
2. Open `/apps` and confirm Apps index renders.
3. Open `/apps/holdstation-mini-app`.
4. Confirm tabs: Dashboard, Inputs & Priorities, Plan & Recap, Tasks, CMO Sessions.
5. Confirm Dashboard shows no fake metrics.
6. Save a C-Level Priority from Inputs & Priorities and verify `C-Level Priorities.md`.
7. Confirm Project Docs/Input paths are visible.
8. Confirm Context Pack includes C-Level Priorities and states selected-context-only behavior.
9. Create weekly/monthly plan placeholders from Plan & Recap.
10. Confirm Tasks shows Task Tracker not connected.
11. Confirm CMO Sessions shows history and current chat.
12. Send a CMO chat message and confirm fallback remains labeled if runtime is unavailable.
13. Save a session to Vault and verify a session Markdown note.
14. Capture a session to Raw Vault and verify session metadata appears.
15. Confirm `/daily` does not overwrite an existing Daily Note silently.
16. Confirm `/vault` still renders.
