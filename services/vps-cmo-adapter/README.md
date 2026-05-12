# VPS CMO Adapter Service

VPS-side service for the remote dashboard adapter contract.

The service serves normalized dashboard JSON only. It keeps the Windows dashboard behind the adapter API and does not expose OpenClaw Gateway.

## Trigger Modes

`CMO_TRIGGER_MODE=mock` is the default. In mock mode, `POST /cmo/run-brief` writes mock raw JSON, a normalized run JSON file, `latest.json`, and `latest_successful.json` when the mock run is completed. This mode works on Windows and does not require the `openclaw` binary.

`CMO_TRIGGER_MODE=openclaw-cron` enables the VPS OpenClaw cron trigger path. In this mode, `POST /cmo/run-brief` creates a normalized `running` run, updates `latest.json`, writes trigger status metadata, and starts a local OpenClaw one-shot cron trigger for `agentId: "cmo"` with isolated session delivery mode `none`. The HTTP request returns the running run.

Phase 5B finalization now happens when `GET /cmo/runs/:runId` or `GET /cmo/latest` is read. If CMO has written `runs/{runId}.json` with `status: "completed"`, the adapter validates the dashboard contract, promotes the completed run to `latest.json`, updates `latest_successful.json`, and returns the completed run. If the run is still running, the adapter returns the running run until `CMO_RUN_TIMEOUT_SECONDS` is exceeded. Timed-out or invalid completed runs update `latest.json` but do not overwrite `latest_successful.json`.

## Run Locally

From the repository root:

```bash
npm run adapter:dev
```

For a production-style start:

```bash
npm run adapter:start
```

The service listens on `CMO_ADAPTER_PORT` or `PORT`, defaulting to `8787`.

## Environment

```bash
CMO_ADAPTER_API_KEY=change-me
CMO_DASHBOARD_DATA_DIR=/home/ju/.openclaw/workspace/data/cmo-dashboard
CMO_SCHEMA_VERSION=cmo.dashboard.v1
CMO_TRIGGER_MODE=mock
OPENCLAW_BIN=openclaw
CMO_AGENT_ID=cmo
CMO_RUN_TIMEOUT_SECONDS=900
CMO_CRON_RUN_TIMEOUT_MS=180000
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_TIMEOUT_MS=120000
CMO_ADAPTER_HOST=0.0.0.0
CMO_ADAPTER_PORT=8787
```

For local testing on Windows, keep `CMO_TRIGGER_MODE=mock` and point `CMO_DASHBOARD_DATA_DIR` at a writable local folder.

For VPS OpenClaw trigger testing, set:

```bash
CMO_TRIGGER_MODE=openclaw-cron
OPENCLAW_BIN=openclaw
CMO_AGENT_ID=cmo
```

## Endpoints

All `/cmo/*` routes require:

```http
Authorization: Bearer <CMO_ADAPTER_API_KEY>
```

- `GET /cmo/status`
- `GET /cmo/latest`
- `GET /cmo/runs/:runId`
- `POST /cmo/run-brief`

`GET /cmo/latest` attempts finalization before responding. This covers the case where `latest.json` still contains the initial `running` state but `runs/{runId}.json` has already been replaced by completed CMO output.

## OpenClaw Metadata Safety

Public run JSON and API responses expose only safe OpenClaw metadata:

- `mode`
- `agent_id`
- `job_id`
- `job_name`
- `schedule_at`
- `openclaw_run_id`
- `trigger_status`
- `raw_markdown_path`
- `normalized_json_path`
- `spec_path`

Full cron payloads, CMO prompts, stdout, and stderr are not written to public run JSON. Private CLI debug output is stored under `status/{runId}.debug.json` for VPS operators.

## Curl Examples

```bash
curl -H "Authorization: Bearer $CMO_ADAPTER_API_KEY" \
  http://localhost:8787/cmo/status
```

```bash
curl -X POST http://localhost:8787/cmo/run-brief \
  -H "Authorization: Bearer $CMO_ADAPTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"workspace":"Holdstation"}'
```

```bash
curl -H "Authorization: Bearer $CMO_ADAPTER_API_KEY" \
  http://localhost:8787/cmo/latest
```

```bash
curl -H "Authorization: Bearer $CMO_ADAPTER_API_KEY" \
  http://localhost:8787/cmo/runs/run_20260512000100_example
```

## VPS Deployment Note

Run this service on the VPS close to the OpenClaw runtime, behind HTTPS and a process manager such as `systemd` or `pm2`. The Windows dashboard should call this adapter over HTTPS using `CMO_REMOTE_ADAPTER_URL` and `CMO_REMOTE_ADAPTER_API_KEY`.

## Security Note

Never expose OpenClaw Gateway directly. `OPENCLAW_GATEWAY_URL` is VPS-internal and should remain loopback-only, for example `ws://127.0.0.1:18789`. The Windows dashboard must not call OpenClaw directly.
