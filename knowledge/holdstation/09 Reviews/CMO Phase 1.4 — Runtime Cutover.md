# CMO Phase 1.4 - Runtime Cutover + First Confirmed App Memory

Status: blocker documented

## Scope

Phase 1.4 verifies the adapter-first runtime path and reviews Holdstation Mini App memory without building Phase 2 features.

Runtime path under test:

Next.js `/api/cmo/chat` -> app chat adapter boundary -> `remote-client` -> VPS `/cmo/chat` -> `openclaw-cron` -> OpenClaw CMO agent

## Env Vars Used

Next.js local environment:

```bash
CMO_ADAPTER_MODE=remote
CMO_REMOTE_ADAPTER_URL=http://127.0.0.1:8787
CMO_REMOTE_ADAPTER_API_KEY=[set locally, redacted]
OPENCLAW_WORKSPACE_ID=[not set locally]
OPENCLAW_CMO_TIMEOUT_MS=[not set locally, default 60000]
```

VPS adapter environment:

```bash
CMO_ADAPTER_API_KEY=[not directly verifiable from this machine]
CMO_TRIGGER_MODE=[not directly verifiable from this machine]
OPENCLAW_BIN=[not directly verifiable from this machine]
CMO_AGENT_ID=[not directly verifiable from this machine]
OPENCLAW_WORKSPACE_ID=[not directly verifiable from this machine]
```

## Status Checks

### VPS /cmo/status

Command target:

```bash
GET http://127.0.0.1:8787/cmo/status
Authorization: Bearer [redacted]
```

Result:

```text
VPS_STATUS_RESULT=configured_but_unreachable
BLOCKER=Unable to connect to the remote server
```

This does not verify the VPS adapter or OpenClaw CMO runtime. The configured adapter URL points to localhost from this machine, and no adapter service responded there.

### Next.js /api/cmo/status

Command target:

```bash
GET http://127.0.0.1:3000/api/cmo/status
```

Result:

```json
{
  "schema_version": "cmo.dashboard.v1",
  "ok": false,
  "mode": "remote",
  "adapter": "remote",
  "adapter_reachable": false,
  "remote_adapter_url_configured": true,
  "runtime_status": "configured_but_unreachable",
  "openclaw_runtime": "configured_but_unreachable",
  "runtime_reason": "Remote CMO Adapter is unavailable"
}
```

### /api/cmo/chat

Test app:

```text
Holdstation Mini App
```

Result:

```text
CHAT_STATUS=completed
CHAT_RUNTIME=configured_but_unreachable
CHAT_FALLBACK=True
CHAT_CONTEXT_USED=7
CHAT_MISSING=0
CHAT_CONFIRMED=0
CHAT_DRAFT=0
CHAT_PLACEHOLDER=7
```

Live runtime verified: no.

Fallback result: yes, honest fallback remained enabled because runtime status was not connected.

## Blocker

Exact blocker:

- `CMO_ADAPTER_MODE=remote` is set.
- `CMO_REMOTE_ADAPTER_URL` is set.
- `CMO_REMOTE_ADAPTER_API_KEY` is set locally.
- The configured adapter endpoint `http://127.0.0.1:8787/cmo/status` is unreachable from this machine.
- VPS-side service state and env vars could not be verified because no reachable VPS adapter URL/service was available.

Required before Phase 2:

- Provide a reachable VPS adapter URL from the Next.js runtime environment.
- Start the VPS adapter with `CMO_TRIGGER_MODE=openclaw-cron`.
- Configure `CMO_ADAPTER_API_KEY`, `OPENCLAW_BIN`, and `CMO_AGENT_ID` on the VPS adapter.
- Verify `/cmo/status` returns `runtime_status=connected`.
- Verify `/api/cmo/chat` returns `isDevelopmentFallback=false`.

## Context Quality Result

Holdstation Mini App app-memory review found no source-backed positioning, audience, product, or content facts beyond app workspace existence. No notes were marked confirmed.

Current quality:

```text
7 / 7 context files found
0 confirmed
0 draft
7 placeholder
0 missing
```

Per-note quality:

- Positioning.md: placeholder
- Audience.md: placeholder
- Product Notes.md: placeholder
- Content Notes.md: placeholder
- Decisions.md: placeholder
- Tasks.md: placeholder
- Learnings.md: placeholder

The four app-memory notes requested for Phase 1.4 now include structured Needs Input sections and remain `status: placeholder`.

## Raw Capture Verification

Raw capture appended:

```text
knowledge/holdstation/06 Journal/Raw/2026-05-14.md
```

The Phase 1.4 capture includes:

- `Runtime: configured_but_unreachable`
- `Fallback: true`
- selected context notes
- context notes actually used
- missing selected context
- context files found count
- confirmed/draft/placeholder/missing counts
- per-note context quality

## UI Verification Result

Local app route checks:

```text
/apps/holdstation-mini-app: loads
/apps/holdstation-mini-app contains Runtime: Configured but unreachable
/apps/holdstation-mini-app does not contain Runtime: Connected
/apps/holdstation-mini-app contains 0 confirmed, 0 draft, 7 placeholder
/apps/holdstation-mini-app contains the placeholder warning
/daily: 200
/vault: 200
```

No daily-note generation was triggered during Phase 1.4 verification, so `/daily` remained overwrite-safe.

## Manual Test Steps

1. Open `/apps/holdstation-mini-app`.
2. Confirm the runtime badge is not `Runtime: Connected` unless `/api/cmo/status` returns `connected`.
3. Confirm context quality shows context files found, confirmed count, draft count, and placeholder count.
4. Send a CMO chat message.
5. Confirm connected runtime only when `/api/cmo/chat` returns `isDevelopmentFallback=false`.
6. If fallback is returned, confirm the answer states the runtime is not connected.
7. Capture the session to Raw Vault.
8. Confirm the raw capture records runtime status, fallback flag, selected context, missing context, and per-note quality.
9. Open `/daily` and confirm existing daily notes are not overwritten.
10. Open `/vault` and confirm vault visibility still loads.

## Verification Commands

```bash
npm run lint
npm run adapter:build
npm run build
```

Result:

```text
npm run lint: pass
npm run adapter:build: pass
npm run build: pass
```

## Phase 2 Readiness

Phase 1 is not ready for Phase 2.

Reasons:

- Live OpenClaw CMO runtime was not verified.
- `/api/cmo/chat` still returns an honest fallback for Holdstation Mini App.
- Holdstation Mini App has 0 confirmed app-memory notes.
