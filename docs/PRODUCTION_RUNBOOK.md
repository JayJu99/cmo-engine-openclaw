# CMO Engine Production Runbook

This runbook documents the production operating model for the CMO Engine Dashboard at `https://cmo.jayju.cloud`. It is intended for maintenance, deployments, troubleshooting, and recovery without exposing secrets or modifying runtime data unnecessarily.

## System overview

The dashboard is a Basic Auth protected Next.js application served publicly through Traefik HTTPS. The dashboard does not call OpenClaw Gateway directly. It calls a private VPS Adapter, which owns the CMO dashboard data directory and triggers OpenClaw CMO runs through the private OpenClaw runtime.

Current production state:

- Public dashboard: `https://cmo.jayju.cloud`
- Dashboard bind address on VPS: `127.0.0.1:3002`
- VPS Adapter bind address on VPS: `127.0.0.1:8787`
- OpenClaw Gateway bind address on VPS: `127.0.0.1:18789`
- Dashboard access: Basic Auth
- Public HTTPS proxy: Traefik
- CMO trigger mode: real OpenClaw runs through the adapter
- Run Brief, CMO Chat, persistent chat history, Ask CMO links, run archive, and Ops page are enabled.

## Final architecture diagram in text

```text
Browser
  |
  | HTTPS + Basic Auth
  v
Traefik
  |
  | reverse proxy to 127.0.0.1:3002
  v
Next.js CMO Engine Dashboard
  |
  | server-side Bearer auth using CMO_REMOTE_ADAPTER_API_KEY
  v
VPS CMO Adapter
  |
  | local OpenClaw CLI / cron trigger
  v
OpenClaw CMO Agent
  |
  | private loopback gateway
  v
OpenClaw Gateway at ws://127.0.0.1:18789

Persistent data:
  /home/ju/.openclaw/workspace/data/cmo-dashboard
```

## Public URL

Production dashboard:

```text
https://cmo.jayju.cloud
```

Expected behavior:

- Browser requests require Basic Auth.
- `/api/cmo/*` routes are protected by the same Basic Auth session.
- The adapter API key is server-side only and must never be sent to the browser.
- The OpenClaw Gateway must remain private and loopback-only.

## Internal services and ports

| Component | Production address | Exposure | Purpose |
| --- | --- | --- | --- |
| Traefik | `:443`, usually `:80` for redirect/ACME | Public | HTTPS termination and reverse proxy |
| CMO Dashboard | `127.0.0.1:3002` | Private loopback | Next.js dashboard and `/api/cmo/*` proxy routes |
| VPS CMO Adapter | `127.0.0.1:8787` | Private loopback | Normalized CMO data API and OpenClaw trigger owner |
| OpenClaw Gateway | `127.0.0.1:18789` | Private loopback | OpenClaw runtime gateway |

If any service binds to `0.0.0.0`, firewall rules must still prevent direct public access unless it is Traefik.

## Environment files and what they contain

Do not print, commit, paste, or log raw secret values from environment files.

Dashboard environment, usually in the dashboard service environment or `.env.local`:

```bash
CMO_ADAPTER_MODE=remote
CMO_REMOTE_ADAPTER_URL=http://127.0.0.1:8787
CMO_REMOTE_ADAPTER_API_KEY=<adapter-api-key>

DASHBOARD_BASIC_AUTH_ENABLED=true
DASHBOARD_BASIC_AUTH_USERNAME=<dashboard-username>
DASHBOARD_BASIC_AUTH_PASSWORD=<dashboard-password>
```

Adapter environment, usually in the adapter service environment:

```bash
CMO_ADAPTER_API_KEY=<adapter-api-key>
CMO_DASHBOARD_DATA_DIR=/home/ju/.openclaw/workspace/data/cmo-dashboard
CMO_SCHEMA_VERSION=cmo.dashboard.v1
CMO_TRIGGER_MODE=openclaw-cron
OPENCLAW_BIN=openclaw
CMO_AGENT_ID=cmo
CMO_RUN_TIMEOUT_SECONDS=900
CMO_CHAT_TIMEOUT_SECONDS=900
CMO_APP_TURN_REQUEST_TIMEOUT_MS=120000
CMO_APP_TURN_POLL_TIMEOUT_MS=110000
CMO_APP_TURN_POLL_INTERVAL_MS=1000
CMO_CRON_RUN_TIMEOUT_MS=180000
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_TIMEOUT_MS=120000
CMO_ADAPTER_HOST=127.0.0.1
CMO_ADAPTER_PORT=8787
```

Environment safety rules:

- `CMO_REMOTE_ADAPTER_API_KEY` must match `CMO_ADAPTER_API_KEY`.
- Use placeholders in tickets, docs, and chat messages.
- Do not use `NEXT_PUBLIC_*` for any secret.
- Keep `OPENCLAW_GATEWAY_URL` on loopback.
- Keep `.env*` files ignored by git except `.env.example`.

## Service management commands

The repo does not define production unit names. The examples below use:

- Dashboard unit: `cmo-dashboard`
- Adapter unit: `cmo-vps-adapter`
- OpenClaw Gateway unit: `openclaw-gateway`
- Traefik unit: `traefik`

Replace names if the VPS uses different systemd units.

```bash
sudo systemctl status cmo-dashboard --no-pager
sudo systemctl status cmo-vps-adapter --no-pager
sudo systemctl status openclaw-gateway --no-pager
sudo systemctl status traefik --no-pager
```

Restart services:

```bash
sudo systemctl restart cmo-dashboard
sudo systemctl restart cmo-vps-adapter
sudo systemctl restart openclaw-gateway
sudo systemctl restart traefik
```

Follow logs:

```bash
sudo journalctl -u cmo-dashboard -f
sudo journalctl -u cmo-vps-adapter -f
sudo journalctl -u openclaw-gateway -f
sudo journalctl -u traefik -f
```

## Deploy/update workflow

Use this flow for normal dashboard and adapter updates.

```bash
cd /path/to/CMO-Engine-OpenClaw
git pull --ff-only
npm ci
npm run adapter:build
npm run lint
npm run build
sudo systemctl restart cmo-vps-adapter
sudo systemctl restart cmo-dashboard
```

After restart, verify service status and API health before using Run Brief.

```bash
sudo systemctl status cmo-vps-adapter --no-pager
sudo systemctl status cmo-dashboard --no-pager
curl -u '<dashboard-username>:<dashboard-password>' \
  https://cmo.jayju.cloud/api/cmo/status
```

Rollback options depend on the deployment method. For git-based deployment, checkout the last known good commit, rebuild, and restart the adapter and dashboard. Do not delete or overwrite the data directory as part of rollback.

## Health check workflow

Start from the public edge and move inward.

1. Confirm DNS and HTTPS:

```bash
curl -I https://cmo.jayju.cloud
```

Expected result is a Basic Auth challenge or authenticated HTTP response.

2. Confirm dashboard API through Traefik:

```bash
curl -u '<dashboard-username>:<dashboard-password>' \
  https://cmo.jayju.cloud/api/cmo/status
```

3. Confirm adapter directly on loopback:

```bash
curl -H "Authorization: Bearer <adapter-api-key>" \
  http://127.0.0.1:8787/cmo/status
```

4. Confirm latest CMO data can be read:

```bash
curl -H "Authorization: Bearer <adapter-api-key>" \
  http://127.0.0.1:8787/cmo/latest
```

5. Confirm OpenClaw Gateway is listening:

```bash
ss -ltnp | grep ':18789'
sudo systemctl status openclaw-gateway --no-pager
```

## Run Brief troubleshooting

Test Run Brief through the public dashboard API:

```bash
curl -X POST \
  -u '<dashboard-username>:<dashboard-password>' \
  https://cmo.jayju.cloud/api/cmo/run-brief \
  -H "Content-Type: application/json" \
  -d '{"workspace":"Holdstation","requested_by":"operator","input":{"source":"runbook-smoke-test"}}'
```

Test Run Brief directly against the adapter:

```bash
curl -X POST http://127.0.0.1:8787/cmo/run-brief \
  -H "Authorization: Bearer <adapter-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"workspace":"Holdstation","requested_by":"operator","input":{"source":"runbook-smoke-test"}}'
```

If the response stays `running`:

- Read `/cmo/latest`; finalization happens when latest/run endpoints are read.
- Check `CMO_RUN_TIMEOUT_SECONDS` and `CMO_CRON_RUN_TIMEOUT_MS`.
- Inspect adapter logs for cron trigger errors.
- Inspect private status files under the data directory `status/` folder.

Inspect the latest successful run without printing secrets:

```bash
jq '{run_id, created_at, workspace, status, title: .summary.title, next_action: .summary.next_action}' \
  /home/ju/.openclaw/workspace/data/cmo-dashboard/latest_successful.json
```

Inspect adapter logs:

```bash
sudo journalctl -u cmo-vps-adapter -n 200 --no-pager
```

Inspect dashboard logs:

```bash
sudo journalctl -u cmo-dashboard -n 200 --no-pager
```

## CMO Chat troubleshooting

Public chat requests go through `/api/cmo/chat`; direct adapter requests go through `/cmo/chat`.

Start a chat through the adapter:

```bash
curl -X POST http://127.0.0.1:8787/cmo/chat \
  -H "Authorization: Bearer <adapter-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"question":"What should the CMO prioritize today?"}'
```

Poll a chat run:

```bash
curl -H "Authorization: Bearer <adapter-api-key>" \
  http://127.0.0.1:8787/cmo/chat/<chat-run-id>
```

List recent chat runs:

```bash
curl -H "Authorization: Bearer <adapter-api-key>" \
  "http://127.0.0.1:8787/cmo/chat?limit=20"
```

If chat fails:

- Confirm the adapter is in `openclaw-cron` trigger mode.
- Confirm latest dashboard context exists, especially `latest_successful.json`.
- Check `chat/<chat-run-id>.json` for public error metadata.
- Check `status/<chat-run-id>.chat-trigger.json` and `status/<chat-run-id>.chat-debug.json` on the VPS.
- Check adapter logs for `OpenClaw CMO chat trigger failed`.

## App CMO Session troubleshooting

The Holdstation Mini App CMO Session uses `/api/cmo/chat` in the dashboard and the live adapter contract `POST /cmo/app-turn`. This path is separate from `/cmo/run-brief` and must not treat dashboard brief JSON as a chat answer.

Live app-turn request shape:

```json
{
  "schema_version": "cmo.app_turn.request.v1",
  "sessionId": "optional-session-id",
  "workspaceId": "holdstation",
  "appId": "holdstation-mini-app",
  "sourceId": "holdstation__holdstation-mini-app",
  "userMessage": "hi, introduce yourself as the CMO for this workspace",
  "history": [],
  "contextPack": {},
  "metadata": {}
}
```

Successful live response shape:

```json
{
  "schema_version": "cmo.app_turn.response.v1",
  "answer": "Useful app-chat answer.",
  "contextUsed": ["Current Priority", "App Memory"],
  "suggestedActions": ["Optional short action"],
  "runtimeMode": "live",
  "runtimeStatus": "live",
  "runtimeProvider": "openclaw",
  "runtimeAgent": "cmo"
}
```

Test live app-turn through the dashboard:

```bash
CMO_SMOKE_BASE_URL=http://127.0.0.1:3002 \
npm run smoke:cmo-live-app-turn
```

If the dashboard is Basic Auth protected, include either:

```bash
CMO_SMOKE_AUTH_HEADER='Basic <base64-username-password>'
```

or:

```bash
BASIC_AUTH_USERNAME='<dashboard-username>' \
BASIC_AUTH_PASSWORD='<dashboard-password>' \
npm run smoke:cmo-live-app-turn
```

Runtime status interpretation:

- `runtimeMode: "live"` and `runtimeStatus: "live"` mean `/cmo/app-turn` returned a valid app-turn answer.
- `runtimeMode: "fallback"` and `runtimeStatus: "live_failed_then_fallback"` mean the adapter or OpenClaw was reachable enough to attempt live, but app-turn failed and the dashboard generated an honest workspace-context fallback answer.
- `runtimeErrorReason: "unsupported_chat_turn"` means `/cmo/app-turn` is missing or not supported by the adapter.
- `runtimeErrorReason: "timeout"` means the CMO agent did not write valid app-turn JSON before `CMO_APP_TURN_POLL_TIMEOUT_MS` or the dashboard request exceeded `CMO_APP_TURN_REQUEST_TIMEOUT_MS`.
- `runtimeErrorReason: "invalid_response"` means the response was empty, malformed, dashboard JSON, or diagnostic-only.
- `runtimeErrorReason: "execution_error"` means the adapter/OpenClaw invocation failed before a valid app-turn answer was available.

If live app-turn fails:

- Confirm `/cmo/status` reports `app_turn_supported: true`, `trigger_mode: "openclaw-cron"`, and `openclaw_runtime: "connected"`.
- Confirm `CMO_APP_TURN_REQUEST_TIMEOUT_MS` on the dashboard is longer than `CMO_APP_TURN_POLL_TIMEOUT_MS` on the adapter.
- Check `status/<turn-id>.app-turn-trigger.json`, `status/<turn-id>.app-turn-debug.json`, and `status/<turn-id>.openclaw-app-turn-spec.json`.
- Confirm the CMO agent wrote `app-turn/<turn-id>.json` with `schema_version: "cmo.app_turn.response.v1"`.
- Confirm the CMO agent did not write `schema_version: "cmo.dashboard.v1"` for app chat.
- Keep the fallback smoke separate with `npm run smoke:cmo-fallback`; it should pass when live app-turn is unavailable.
- `npm run smoke:cmo-fallback` deliberately forces fallback by default so it does not depend on live app-turn being unsupported or slow. Set `CMO_SMOKE_FORCE_FALLBACK=0` only for ad hoc organic-failure checks.

## Run History troubleshooting

Run history is served from normalized run JSON files under `runs/`.

List runs through the adapter:

```bash
curl -H "Authorization: Bearer <adapter-api-key>" \
  "http://127.0.0.1:8787/cmo/runs?limit=20"
```

Inspect a run:

```bash
curl -H "Authorization: Bearer <adapter-api-key>" \
  http://127.0.0.1:8787/cmo/runs/<run-id>
```

If a run is missing from history:

- Confirm the file exists at `runs/<run-id>.json`.
- Confirm the filename only contains letters, numbers, `_`, `.`, or `-`.
- Confirm the JSON is valid and normalized.
- Check adapter logs for skipped malformed JSON.
- Remember that raw, debug, status, latest, and latest successful files are intentionally excluded from the run archive.

## Traefik/domain troubleshooting

Check Traefik:

```bash
sudo systemctl status traefik --no-pager
sudo journalctl -u traefik -n 200 --no-pager
```

Check local dashboard port:

```bash
curl -I http://127.0.0.1:3002
ss -ltnp | grep ':3002'
```

Check public TLS and routing:

```bash
curl -I https://cmo.jayju.cloud
curl -u '<dashboard-username>:<dashboard-password>' \
  https://cmo.jayju.cloud/api/cmo/status
```

If the domain fails:

- Verify DNS points to the VPS.
- Verify Traefik router rule targets `cmo.jayju.cloud`.
- Verify the dashboard service is listening on `127.0.0.1:3002`.
- Verify Traefik forwards to the dashboard port, not the adapter or OpenClaw Gateway.
- Verify certificate resolver/ACME storage is healthy.

## OpenClaw Gateway troubleshooting

The gateway must stay private at `127.0.0.1:18789`.

Check OpenClaw Gateway:

```bash
sudo systemctl status openclaw-gateway --no-pager
ss -ltnp | grep ':18789'
```

Check adapter configuration:

```bash
curl -H "Authorization: Bearer <adapter-api-key>" \
  http://127.0.0.1:8787/cmo/status
```

Expected fields include:

- `gateway_mode: "loopback"`
- `trigger_mode: "openclaw-cron"`
- `openclaw_trigger_enabled: true`
- `cmo_agent_id: "cmo"`

If OpenClaw runs do not start:

- Confirm `OPENCLAW_BIN` resolves for the adapter service user.
- Confirm `CMO_AGENT_ID=cmo`.
- Confirm the gateway is listening on loopback.
- Inspect adapter debug files under `status/`.
- Inspect OpenClaw Gateway logs.

## Data directory layout

Production data directory:

```text
/home/ju/.openclaw/workspace/data/cmo-dashboard/
  latest.json
  latest_successful.json
  runs/
    <run-id>.json
  raw/
    <run-id>.md or <run-id>.json
  status/
    <run-id>.trigger.json
    <run-id>.debug.json
    <run-id>.openclaw-cron-spec.json
    <chat-run-id>.chat-trigger.json
    <chat-run-id>.chat-debug.json
    <chat-run-id>.openclaw-chat-spec.json
    <turn-id>.app-turn-trigger.json
    <turn-id>.app-turn-debug.json
    <turn-id>.openclaw-app-turn-spec.json
  chat/
    <chat-run-id>.json
    raw/
      <chat-run-id>.md
  app-turn/
    <turn-id>.json
    raw/
      <turn-id>.md
```

Public dashboard APIs only serve sanitized normalized run and chat data. Private debug, raw prompt, stdout, stderr, and status details must remain on the VPS and must not be exposed through Traefik.

## Backup/restore notes

Back up the production data directory before deployments that could affect storage:

```bash
sudo tar -czf /home/ju/cmo-dashboard-backup-$(date +%Y%m%d-%H%M%S).tgz \
  -C /home/ju/.openclaw/workspace/data cmo-dashboard
```

Restore only during an outage or planned maintenance window:

```bash
sudo systemctl stop cmo-vps-adapter
sudo tar -xzf /home/ju/<backup-file>.tgz \
  -C /home/ju/.openclaw/workspace/data
sudo systemctl start cmo-vps-adapter
```

Restore safety:

- Stop the adapter before restore to avoid concurrent writes.
- Preserve file ownership expected by the adapter service user.
- Restore the entire `cmo-dashboard` directory when possible.
- Do not hand-edit `latest_successful.json` unless recovering from corrupted JSON and a backup is unavailable.
- Keep backups off the public web root.

## Security checklist

- Basic Auth is enabled for the public dashboard.
- Basic Auth username and password are not committed.
- Adapter API key is not committed and is not exposed through `NEXT_PUBLIC_*`.
- Dashboard uses `CMO_ADAPTER_MODE=remote` in production.
- Dashboard calls `CMO_REMOTE_ADAPTER_URL=http://127.0.0.1:8787` or another private URL.
- Adapter requires `Authorization: Bearer <adapter-api-key>`.
- Adapter binds to loopback or is firewall-protected.
- OpenClaw Gateway remains `ws://127.0.0.1:18789`.
- Traefik is the only public entrypoint.
- Runtime data, raw output, debug files, and status files are not served statically.
- Logs and support requests use placeholders instead of raw secrets.
- `.env*` files remain gitignored except `.env.example`.

## Known limitations

- The adapter status endpoint checks CLI/runtime reachability and gateway socket reachability, but it is still not proof that the CMO agent can complete a valid app-turn answer.
- Live CMO Session depends on the OpenClaw CMO agent writing valid `cmo.app_turn.response.v1` JSON to the adapter-provided `app-turn/<turn-id>.json` path before `CMO_APP_TURN_POLL_TIMEOUT_MS`; otherwise the dashboard keeps using fallback.
- `/cmo/latest` and `/cmo/runs/<run-id>` perform finalization reads for running OpenClaw outputs, so a run can become completed during read.
- Completed OpenClaw output must match the dashboard contract after repair/normalization; invalid output becomes `partial` and does not replace `latest_successful.json`.
- Run archive intentionally skips malformed JSON and non-run files.
- Basic Auth protects the dashboard, but it is not a full user management system.
- Service unit names may differ from the examples in this runbook.

## Next planned work: core logic and onboarding flow refinement

Next planned work is focused on product logic rather than infrastructure:

- Refine the core CMO decision logic.
- Improve onboarding flow structure and copy.
- Tighten handoff from onboarding inputs into CMO runs.
- Continue improving action, signal, campaign, and run context passed into Ask CMO.
