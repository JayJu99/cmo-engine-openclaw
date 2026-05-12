# VPS CMO Adapter Service

Phase 4C skeleton service for the remote dashboard adapter contract.

This service serves normalized dashboard JSON only. It does not call OpenClaw Gateway yet, does not trigger the CMO agent yet, and does not expose raw output through HTTP.

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
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_TIMEOUT_MS=120000
CMO_ADAPTER_HOST=0.0.0.0
CMO_ADAPTER_PORT=8787
```

For local testing on Windows, point `CMO_DASHBOARD_DATA_DIR` at a writable local folder.

## Endpoints

All `/cmo/*` routes require:

```http
Authorization: Bearer <CMO_ADAPTER_API_KEY>
```

- `GET /cmo/status`
- `GET /cmo/latest`
- `GET /cmo/runs/:runId`
- `POST /cmo/run-brief`

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

Never expose OpenClaw Gateway directly. `OPENCLAW_GATEWAY_URL` is reserved for a future internal Phase 5 trigger path and should remain loopback-only, for example `ws://127.0.0.1:18789`.
