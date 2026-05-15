# CMO Phase 1.3 - Live Runtime Smoke + Context Quality Status

Status: blocker documented

## Required Env Vars

Next.js side:

```bash
CMO_ADAPTER_MODE=remote
CMO_REMOTE_ADAPTER_URL=https://your-adapter.example.com
CMO_REMOTE_ADAPTER_API_KEY=...
OPENCLAW_WORKSPACE_ID=... # optional
OPENCLAW_CMO_TIMEOUT_MS=60000
```

VPS adapter side:

```bash
CMO_ADAPTER_API_KEY=...
CMO_TRIGGER_MODE=openclaw-cron
OPENCLAW_BIN=openclaw
CMO_AGENT_ID=cmo
OPENCLAW_WORKSPACE_ID=... # optional
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

Open `http://localhost:3000`.

## Start VPS Adapter

On the VPS or adapter host, from the repo root:

```bash
npm run adapter:start
```

For adapter development:

```bash
npm run adapter:dev
```

The VPS adapter must be started with `CMO_ADAPTER_API_KEY`, `CMO_TRIGGER_MODE=openclaw-cron`, `OPENCLAW_BIN`, and `CMO_AGENT_ID`.

## Check VPS /cmo/status

```bash
curl -H "Authorization: Bearer $CMO_ADAPTER_API_KEY" \
  "$CMO_REMOTE_ADAPTER_URL/cmo/status"
```

Connected requires:

- `runtime_status=connected`
- `openclaw_runtime=connected`
- `trigger_mode=openclaw-cron`
- `openclaw_trigger_enabled=true`
- `openclaw_bin_status=executable`
- `cmo_agent_configured=true`

Do not mark connected if the VPS adapter cannot be reached or if `/cmo/status` does not return `connected`.

## Check Next.js /api/cmo/status

```bash
curl http://localhost:3000/api/cmo/status
```

Expected status states:

- `not_configured`: remote mode is missing the URL or API key.
- `configured_but_unreachable`: remote mode is configured, but the VPS adapter did not respond.
- `development_fallback`: local/mock mode or VPS adapter is reachable but not in `openclaw-cron` mode.
- `runtime_error`: adapter responded, but runtime status check failed.
- `connected`: remote adapter status passed and OpenClaw runtime is executable.

Current local result on 2026-05-14:

```json
{
  "mode": "remote",
  "adapter": "remote",
  "adapter_reachable": false,
  "remote_adapter_url_configured": true,
  "runtime_status": "configured_but_unreachable",
  "openclaw_runtime": "configured_but_unreachable",
  "runtime_reason": "Remote CMO Adapter is unavailable"
}
```

## Test Chat In App Workspace

1. Open `/`.
2. Confirm Command Center loads.
3. Open `/apps`.
4. Open `/apps/holdstation-mini-app`.
5. Confirm the runtime badge is not `Connected` unless `/api/cmo/status` is connected.
6. Confirm context files show file existence and quality badges.
7. Send a CMO chat message.

Real runtime answer:

- `/api/cmo/chat` returns `isDevelopmentFallback=false`.
- `runtimeStatus=connected`.
- The answer is not labeled development fallback.

Fallback answer:

- `/api/cmo/chat` returns `isDevelopmentFallback=true`.
- Runtime status remains one of `not_configured`, `configured_but_unreachable`, or `development_fallback`.
- The answer explicitly says the OpenClaw CMO runtime is not connected.

Current local chat result:

- `status=completed`
- `runtimeStatus=configured_but_unreachable`
- `isDevelopmentFallback=true`
- `contextUsed=7`
- `missingContext=0`
- `confirmed=0`
- `placeholder=7`

## Verify Raw Capture

After a chat response is visible, click `Capture to Raw Vault` or POST to `/api/vault/raw-captures`.

Verify `knowledge/holdstation/06 Journal/Raw/YYYY-MM-DD.md` includes:

- `Runtime: configured_but_unreachable` or `Runtime: connected`
- `Fallback: true` or `Fallback: false`
- selected context notes
- context notes actually used
- missing selected context
- context diagnostics
- context quality summary
- CMO answer

Current local raw capture result:

- Path: `knowledge/holdstation/06 Journal/Raw/2026-05-14.md`
- Capture appended: yes
- Runtime: `configured_but_unreachable`
- Fallback: `true`
- Context Quality:
  - Positioning: placeholder
  - Audience: placeholder
  - Product Notes: placeholder
  - Content Notes: placeholder
  - Decisions: placeholder
  - Tasks: placeholder
  - Learnings: placeholder

## Inspect Context Quality

Context quality is derived from note frontmatter and placeholder language.

Frontmatter statuses:

- `status: placeholder` => `placeholder`
- `status: draft` => `draft` unless placeholder language is detected
- `status: active` => `confirmed` unless placeholder language is detected
- `status: confirmed` => `confirmed` unless placeholder language is detected

Placeholder language includes examples such as:

- `No durable positioning note has been confirmed yet.`
- `Add confirmed positioning here`
- `Working Notes`
- `Open Questions`

Current Holdstation Mini App app-note quality:

- 7 / 7 app notes found
- 0 confirmed
- 7 placeholder
- 0 draft
- 0 missing

If today's Daily Note is selected in the workspace context selector, the selected context count can be 8 / 8: seven placeholder app notes plus one draft daily note.

## Current Result

- connected: no
- configured_but_unreachable: yes
- fallback: yes
- blocker details: Next.js remote adapter settings are present, but the remote VPS adapter is unavailable from this machine. VPS-side access and secrets were not available here, so `/cmo/status` could not be checked directly on the VPS and the OpenClaw CMO agent could not be verified live.

Exact missing requirement before Phase 2:

- Reachable VPS adapter URL from this environment.
- Valid VPS-side `CMO_ADAPTER_API_KEY` for direct `/cmo/status` check.
- VPS shell or service access to start the adapter with `CMO_TRIGGER_MODE=openclaw-cron`, `OPENCLAW_BIN`, and `CMO_AGENT_ID`.
- Confirmation that `/api/cmo/chat` returns `isDevelopmentFallback=false` with `runtimeStatus=connected`.
