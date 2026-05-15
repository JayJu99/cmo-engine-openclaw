# CMO Phase 1.2 - Runtime Smoke Test

Status: draft

## Runtime Path

Primary production path:

Next.js `/api/cmo/chat` -> `src/lib/cmo/adapter.ts` -> `src/lib/cmo/remote-client.ts` -> VPS adapter `/cmo/chat` -> `openclaw-cron` -> OpenClaw CMO agent.

Direct `OPENCLAW_CMO_ENDPOINT` remains a local/dev direct mode only when `CMO_ADAPTER_MODE` is not `remote`.

## Required Env Vars

Next.js side:

```bash
CMO_ADAPTER_MODE=remote
CMO_REMOTE_ADAPTER_URL=https://your-adapter.example.com
CMO_REMOTE_ADAPTER_API_KEY=...
OPENCLAW_WORKSPACE_ID=... # optional, only if the runtime needs it
OPENCLAW_CMO_TIMEOUT_MS=60000
```

VPS adapter side:

```bash
CMO_ADAPTER_API_KEY=...
CMO_TRIGGER_MODE=openclaw-cron
OPENCLAW_BIN=openclaw
CMO_AGENT_ID=cmo
OPENCLAW_WORKSPACE_ID=... # optional, only if the runtime needs it
CMO_DASHBOARD_DATA_DIR=/home/ju/.openclaw/workspace/data/cmo-dashboard
CMO_CHAT_TIMEOUT_SECONDS=900
CMO_CRON_RUN_TIMEOUT_MS=180000
CMO_ADAPTER_HOST=0.0.0.0
CMO_ADAPTER_PORT=8787
```

Do not commit secrets.

## Start Next.js

From the repo root:

```bash
npm run dev
```

Open the printed localhost URL.

## Start VPS Adapter

From the repo root on the adapter host:

```bash
npm run adapter:start
```

For local adapter development:

```bash
npm run adapter:dev
```

## Check Adapter Status

```bash
curl -H "Authorization: Bearer $CMO_ADAPTER_API_KEY" \
  "$CMO_REMOTE_ADAPTER_URL/cmo/status"
```

Expected connected status:

- `trigger_mode` is `openclaw-cron`
- `openclaw_trigger_enabled` is `true`
- `runtime_status` is `connected`
- `openclaw_runtime` is `connected`
- `openclaw_bin_status` is `executable`
- `cmo_agent_configured` is `true`

Expected fallback status in mock/local mode:

- `runtime_status` is `development_fallback`
- `openclaw_runtime` is `development_fallback`

Expected unreachable status:

- `runtime_status` is `configured_but_unreachable`
- `openclaw_runtime` is `configured_but_unreachable`

## Open App Workspace

1. Open `/`.
2. Confirm the Command Center loads.
3. Open `/apps`.
4. Open `/apps/holdstation-mini-app`.
5. Confirm the App Workspace loads.
6. Confirm selected context notes show as existing.

## Send Chat

1. Keep the default selected app notes checked.
2. Ask a small app-specific question.
3. Submit the CMO Chat message.
4. Confirm the UI runtime badge shows one of:
   - `Runtime: Connected`
   - `Runtime: Configured but unreachable`
   - `Runtime: Development fallback`
   - `Runtime: Error`
   - `Runtime: Not configured`

## Confirm Runtime Behavior

Connected behavior:

- Next.js calls `/api/cmo/chat`.
- The app context package contains only selected app notes.
- The VPS adapter receives `/cmo/chat`.
- The adapter is in `openclaw-cron` mode.
- OpenClaw CMO writes or completes the chat response.
- The UI shows the CMO answer.

Fallback behavior:

- If local/mock mode is active, the UI must show `Runtime: Development fallback`.
- If remote adapter env is missing, the UI must show `Runtime: Not configured`.
- If remote adapter is configured but unreachable, the UI must show `Runtime: Configured but unreachable`.
- The UI must not claim `Runtime: Connected` unless `/cmo/status` passed the runtime check.

## Capture to Raw Vault

1. Click `Capture to Raw Vault` after a chat response is visible.
2. Confirm the success message references `06 Journal/Raw/YYYY-MM-DD.md`.
3. Open the raw note.
4. Verify the appended section includes:
   - app id
   - app name
   - topic
   - runtime status
   - development fallback flag
   - selected context notes
   - context notes actually used
   - missing selected context
   - context diagnostics
   - user messages
   - CMO answer
   - timestamp

## Generate or Verify Daily Note

1. Open `/daily`.
2. If today's Daily Note does not exist, click `Generate Daily Note`.
3. If today's Daily Note already exists, confirm the page shows the existing-note state and does not overwrite silently.
4. Verify the Daily Note includes:
   - apps touched
   - runtime statuses from captured CMO sessions
   - key discussions from raw captures

## Vault Visibility

Open `/vault` and verify:

- today's raw path is shown
- today's daily path is shown
- app note paths are shown
- seeded app notes report `Exists`

## Expected Result

Phase 1.2 is complete when the selected app context resolves to real Vault notes, `/api/cmo/chat` uses the adapter-first runtime path, status is accurate, raw capture remains append-only, Daily Note generation remains overwrite-safe, and lint/build pass.
