# OpenClaw Integration Plan

## 1. Current Architecture

CMO Engine OpenClaw currently uses a file-backed CMO Adapter layer between the dashboard UI and any future agent runtime.

Current flow:

1. Dashboard pages render through Next.js App Router.
2. Pages read normalized CMO run data from the adapter.
3. API routes under `/api/cmo/*` expose the same adapter data as JSON.
4. The adapter reads from `data/latest.json`, `data/latest_successful.json`, and historical files in `data/runs/{runId}.json`.
5. If files are missing or malformed, normalization helpers fall back to the existing dashboard mock data.

No OpenClaw Gateway, OpenClaw agent trigger, external workflow, or remote service is connected yet.

Recent OpenClaw environment discovery confirmed:

- `openclaw gateway status` reports the Gateway running at `127.0.0.1:18789`.
- The Gateway is loopback-only and must remain private in V1.
- `openclaw status` reports the runtime active.
- Existing `cmo` sessions and cron are running.
- `cron list` confirmed the working trigger pattern uses `agentId: "cmo"`, `payload.kind: "agentTurn"`, and `sessionTarget: "isolated"`.
- `tasks list --json` confirmed the task ledger is working.
- Direct Gateway trigger APIs are not yet treated as a stable public dashboard contract.

Key files:

- `data/latest.json`
- `data/latest_successful.json`
- `data/runs/{runId}.json`
- `data/raw/{runId}.json`
- `src/lib/cmo/types.ts`
- `src/lib/cmo/validation.ts`
- `src/lib/cmo/store.ts`
- `src/app/api/cmo/*/route.ts`

## 2. Data Contract Summary

Every dashboard JSON object should include:

- `schema_version`: `"cmo.dashboard.v1"`

Every CMO run should include:

- `schema_version`
- `run_id`
- `created_at`
- `workspace`
- `status`
- `summary`
- `actions`
- `signals`
- `agents`
- `campaigns`
- `reports`
- `vault`

For local dashboard development, the canonical newest-run state is `data/latest.json`. Historical immutable run snapshots live at `data/runs/{runId}.json`. Raw OpenClaw output is captured at `data/raw/{runId}.json`.

For V1 production, the VPS-side source-of-truth paths are:

- `/home/ju/.openclaw/workspace/data/cmo-dashboard/raw/{runId}.json`
- `/home/ju/.openclaw/workspace/data/cmo-dashboard/runs/{runId}.json`
- `/home/ju/.openclaw/workspace/data/cmo-dashboard/latest.json`
- `/home/ju/.openclaw/workspace/data/cmo-dashboard/latest_successful.json`

Latest file semantics:

- `latest.json`: newest run, including `completed`, `partial`, `failed`, or `timeout`.
- `latest_successful.json`: most recent completed valid run.

Overview and dashboard summary views should prefer `data/latest_successful.json` when it is available, because those views should remain stable when the newest run failed, timed out, or produced invalid output.

The adapter normalizes the raw file payload into typed dashboard objects before the UI consumes it.

Raw output is an unstable OpenClaw, agent, or runtime payload. It must never be rendered directly by the dashboard.

## 3. API Routes Already Implemented

Read routes:

- `GET /api/cmo/runs/latest`
- `GET /api/cmo/runs`
- `GET /api/cmo/actions`
- `GET /api/cmo/signals`
- `GET /api/cmo/agents`
- `GET /api/cmo/campaigns`
- `GET /api/cmo/reports`
- `GET /api/cmo/vault`

Write route:

- `POST /api/cmo/run-brief`

Current `POST /api/cmo/run-brief` behavior is mock-only:

1. Generate `run_id`.
2. Create `data/runs/{run_id}.json`.
3. Update `data/latest.json`.
4. Return the created run.

## 4. Final V1 Architecture

V1 should not have the Windows dashboard call OpenClaw Gateway directly. The dashboard should call a VPS-side CMO Adapter API over HTTPS with an API key. The VPS Adapter should run close to OpenClaw and trigger CMO locally.

Final V1 flow:

```text
Windows Dashboard
  -> HTTPS/API key
  -> VPS CMO Adapter API
  -> local OpenClaw trigger
  -> OpenClaw workspace files
  -> normalized dashboard JSON
  -> dashboard render
```

Production flow:

1. User clicks `Run Brief` in the dashboard.
2. Dashboard calls its local `POST /api/cmo/run-brief` route.
3. The dashboard route uses `CMO_ADAPTER_MODE`.
4. In `remote` mode, the dashboard route calls the VPS CMO Adapter API with `CMO_REMOTE_ADAPTER_URL` and `CMO_REMOTE_ADAPTER_API_KEY`.
5. The VPS Adapter authenticates the request.
6. The VPS Adapter creates or accepts a run ID and triggers CMO locally near OpenClaw.
7. OpenClaw executes the CMO agent turn using the confirmed runtime pattern.
8. CMO writes raw and normalized output to approved workspace paths under `/home/ju/.openclaw/workspace/data/cmo-dashboard`.
9. The VPS Adapter serves normalized dashboard JSON from those files.
10. The Windows dashboard refreshes from its local API route, which proxies or maps the VPS Adapter response.

Direct Gateway trigger APIs are not a V1 dashboard contract. The Gateway may be used internally by the VPS Adapter if that proves stable, but it must stay loopback-only and private.

## 5. Fallback Script/CLI Flow

Keep local JSON/mock mode as the development fallback and recovery path. This path should continue to work without a VPS Adapter, OpenClaw Gateway, or live CMO trigger.

Proposed flow:

1. Operator runs a script such as `npm run cmo:run-brief`.
2. Script invokes OpenClaw CLI or a local workflow command.
3. Script captures raw output to `data/raw/{runId}.json`.
4. Script calls adapter normalization logic.
5. Script writes `data/runs/{run_id}.json`.
6. Script updates `data/latest.json`.
7. Script updates `data/latest_successful.json` only for completed valid runs.
8. Dashboard reads the new state through existing API routes.

This fallback should use the same normalization and validation code as the API route to prevent drift.

## 6. Raw Output To Dashboard JSON Flow

Canonical V1 processing pipeline:

```text
OpenClaw raw output
  -> raw capture at /home/ju/.openclaw/workspace/data/cmo-dashboard/raw/{runId}.json
  -> adapter mapper
  -> normalized CMO run object
  -> schema validation
  -> write /home/ju/.openclaw/workspace/data/cmo-dashboard/runs/{runId}.json
  -> update /home/ju/.openclaw/workspace/data/cmo-dashboard/latest.json for newest run
  -> update /home/ju/.openclaw/workspace/data/cmo-dashboard/latest_successful.json only when completed and valid
  -> VPS Adapter API response
  -> Windows dashboard render
```

Rules:

- Preserve raw output at `raw/{runId}.json` for debugging when possible.
- Treat raw output as unstable OpenClaw, agent, or runtime payload.
- Never expose or render raw agent output directly in the dashboard.
- Convert unstable agent fields into stable dashboard contract fields.
- Validate required fields before writing `latest.json`.
- Failed, timeout, or invalid runs may update `latest.json` because it represents the newest run state.
- Failed, timeout, or invalid runs must not overwrite `latest_successful.json`.
- Local JSON/mock mode should keep using `data/raw`, `data/runs`, `data/latest.json`, and `data/latest_successful.json`.
- In OpenClaw cron mode, `GET /cmo/runs/:runId` and `GET /cmo/latest` finalize runs opportunistically. If `latest.json` still contains a `running` run but `runs/{runId}.json` has since become completed, the read request validates and promotes the completed run before responding.

## 7. Error Handling Strategy

Recommended behavior by failure type:

- VPS Adapter unavailable: dashboard route returns `503` with a clear adapter error and keeps current local fallback state.
- OpenClaw Gateway unavailable on the VPS: adapter returns `503`, records the failed run if a run was created, and does not expose Gateway details to the dashboard.
- OpenClaw timeout: mark the new run as `timeout`, write it to `data/runs/{runId}.json`, update `latest.json`, and do not overwrite `latest_successful.json`.
- Invalid raw output: store raw output for inspection, reject normalized write, return validation errors.
- Partial agent output: normalize usable sections, attach warnings, and mark run as `partial`.
- File write failure: return `500`; do not report success to the UI.
- Missing JSON files: continue using existing fallback mock data.
- Schema version mismatch: attempt migration if supported; otherwise reject and log the mismatch.

The dashboard should stay readable even if a run fails. User-facing errors should be concise and actionable.

## 8. Suggested Environment Variables

Dashboard variables:

```text
CMO_ADAPTER_MODE=local|remote
CMO_REMOTE_ADAPTER_URL=
CMO_REMOTE_ADAPTER_API_KEY=
CMO_DATA_DIR=data
CMO_RAW_OUTPUT_DIR=data/raw
CMO_ENABLE_SSE=false
CMO_SCHEMA_VERSION=cmo.dashboard.v1
```

VPS Adapter variables:

```text
CMO_ADAPTER_API_KEY=
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
CMO_DASHBOARD_DATA_DIR=/home/ju/.openclaw/workspace/data/cmo-dashboard
OPENCLAW_TIMEOUT_MS=120000
CMO_SCHEMA_VERSION=cmo.dashboard.v1
CMO_TRIGGER_MODE=mock|openclaw-cron
OPENCLAW_BIN=openclaw
CMO_AGENT_ID=cmo
CMO_RUN_TIMEOUT_SECONDS=900
CMO_APP_TURN_REQUEST_TIMEOUT_MS=120000
CMO_APP_TURN_POLL_TIMEOUT_MS=110000
CMO_APP_TURN_POLL_INTERVAL_MS=1000
CMO_CRON_RUN_TIMEOUT_MS=180000
```

Notes:

- Keep secrets server-side only.
- Do not expose API keys through `NEXT_PUBLIC_*`.
- The Windows dashboard should never receive `OPENCLAW_GATEWAY_URL`.
- `OPENCLAW_GATEWAY_URL` is VPS-internal only and should remain loopback.
- `CMO_ADAPTER_MODE=local` keeps the existing JSON/mock fallback.
- `CMO_ADAPTER_MODE=remote` uses the VPS CMO Adapter API.

## 9. VPS Adapter API Contract

The dashboard should depend on this HTTPS API contract, not on direct OpenClaw Gateway trigger details.

### `POST /cmo/run-brief`

Starts a CMO run.

Request:

```json
{
  "workspace": "default",
  "requested_by": "dashboard",
  "input": {}
}
```

Response may be synchronous if the run completes quickly, or accepted if the run is still executing:

```json
{
  "schema_version": "cmo.dashboard.v1",
  "run_id": "run_...",
  "status": "running"
}
```

### `POST /cmo/app-turn`

Starts one synchronous app workspace CMO chat turn. This endpoint is the live runtime contract for `/apps/holdstation-mini-app` CMO Session chat. It must not call `/cmo/run-brief`, and it must not return dashboard JSON.

Request:

```json
{
  "schema_version": "cmo.app_turn.request.v1",
  "sessionId": "optional-session-id",
  "workspaceId": "holdstation",
  "appId": "holdstation-mini-app",
  "sourceId": "holdstation__holdstation-mini-app",
  "userMessage": "hi, introduce yourself as the CMO for this workspace",
  "history": [],
  "contextPack": {
    "items": ["Current Priority", "App Memory", "Latest Sessions", "Memory Candidates"],
    "graphStatus": "available",
    "graphHintCount": 5,
    "graphHints": ["app-scoped hints only"]
  },
  "graphStatus": "available",
  "graphHintCount": 5,
  "graphHints": ["app-scoped hints only"],
  "metadata": {}
}
```

Response:

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

Implementation notes:

- The VPS adapter authenticates with the same `Authorization: Bearer <CMO_ADAPTER_API_KEY>` pattern.
- In `openclaw-cron` mode, the adapter creates an isolated one-shot OpenClaw CMO cron turn and instructs the agent to write `app-turn/{turnId}.json`.
- The adapter validates that the output is app-turn JSON, has a non-empty `answer`, is not `cmo.dashboard.v1`, and is not fallback diagnostics.
- The dashboard app-turn request timeout is `CMO_APP_TURN_REQUEST_TIMEOUT_MS` and should be slightly longer than the adapter `CMO_APP_TURN_POLL_TIMEOUT_MS`.
- If live app-turn fails, the dashboard keeps the existing fallback provenance: `attemptedRuntimeMode=live`, `runtimeMode=fallback`, `runtimeStatus=live_failed_then_fallback`, and a controlled `runtimeErrorReason`.
- Phase 1.9 adds graph-boosted context hints additively. Hints are scoped to `workspaceId=holdstation`, `appId=holdstation-mini-app`, `sourceId=holdstation__holdstation-mini-app`, and the physical app vault path only. The agent must treat Graph Context Hints as supporting context after Current Priority and App Memory, and must not claim all-vault RAG.

### `GET /cmo/runs/:runId`

Returns the normalized run JSON for a specific run from:

```text
/home/ju/.openclaw/workspace/data/cmo-dashboard/runs/{runId}.json
```

In OpenClaw cron mode, this endpoint is also the finalization boundary:

- Completed CMO-written JSON is normalized, then validated against the dashboard contract.
- Nested `actions`, `signals`, `agents`, `campaigns`, `reports`, and `vault` items are repaired with `schema_version`, stable IDs, and safe UI defaults before strict validation.
- Valid completed JSON is promoted to `latest.json` and `latest_successful.json`.
- Running JSON is returned as running until `CMO_RUN_TIMEOUT_SECONDS` is exceeded.
- Timed-out runs are marked `timeout`, promoted to `latest.json`, and do not update `latest_successful.json`.
- Invalid completed JSON returns a `partial` run with validation error metadata and does not update `latest_successful.json`.

### `GET /cmo/latest`

Returns the newest normalized run from:

```text
/home/ju/.openclaw/workspace/data/cmo-dashboard/latest.json
```

Overview-style dashboard views may request or locally prefer `latest_successful.json` semantics when failed or partial newest runs should not replace stable completed results.

This endpoint attempts the same OpenClaw cron finalization as `GET /cmo/runs/:runId` before responding. This prevents stale `running` state from persisting in `latest.json` after CMO has already written a completed `runs/{runId}.json`.

### `GET /cmo/status`

Returns adapter health, OpenClaw runtime reachability, app-turn capability, and configured data directory visibility.

Example:

```json
{
  "ok": true,
  "adapter": "ok",
  "openclaw_runtime": "connected",
  "openclaw_gateway_status": "reachable",
  "app_turn_supported": true,
  "run_brief_supported": true,
  "gateway_mode": "loopback",
  "data_dir": "/home/ju/.openclaw/workspace/data/cmo-dashboard"
}
```

`adapter: "ok"` means the adapter process is reachable. It is not enough to mark app chat live. App chat should be considered live only when `/cmo/app-turn` returns `schema_version: "cmo.app_turn.response.v1"`, a non-empty `answer`, `runtimeMode: "live"`, and `runtimeStatus: "live"`.

## 10. Future Realtime/SSE Plan

Short-term realtime plan:

1. Add `GET /api/cmo/events`.
2. Use Server-Sent Events for run status updates.
3. Emit events for `queued`, `running`, `normalizing`, `validating`, `completed`, and `failed`.
4. Dashboard subscribes from a small client component.
5. On `completed`, dashboard re-fetches `/api/cmo/runs/latest`.

SSE event example:

```json
{
  "schema_version": "cmo.dashboard.v1",
  "run_id": "run_...",
  "event": "normalizing",
  "created_at": "2026-05-12T00:00:00.000Z",
  "message": "Mapping OpenClaw output to dashboard schema"
}
```

Longer-term options:

- WebSocket channel for multi-user collaboration.
- Queue-backed run state using Redis or durable workflow storage.
- Incremental section updates for actions, signals, and reports.

## 11. Step-By-Step Implementation Phases

### Phase 1: Adapter Contract Foundation

Status: implemented.

- Add file-backed dashboard JSON contracts.
- Add `schema_version` with the canonical value `"cmo.dashboard.v1"`.
- Add `run_id` and `created_at`.
- Add `latest.json`, `latest_successful.json`, raw output capture, and historical run files.
- Add TypeScript schema types.
- Add normalization and fallback helpers.

### Phase 2: API Boundary

Status: implemented.

- Add `/api/cmo/*` read routes.
- Add mock-only `POST /api/cmo/run-brief`.
- Keep OpenClaw disconnected.
- Let dashboard safely consume adapter data.

### Phase 3: Raw Output Capture

Status: implemented.

- Add `data/raw/{runId}.json` as the canonical raw output capture location.
- Add raw output persistence helpers.
- Capture mock `run-brief` raw payloads before normalization.
- Keep normalized dashboard runs in `data/runs/{runId}.json`.
- Update `latest_successful.json` only after completed valid normalized runs.
- Planned follow-up: add adapter mapping tests using captured samples.
- Planned follow-up: define raw OpenClaw output fixtures.

### Phase 4A: Remote VPS Adapter Contract

Status: implemented for dashboard configuration and documentation. VPS service implementation remains planned for Phase 4C.

- Define the VPS Adapter HTTPS/API-key boundary.
- Add dashboard configuration for `CMO_ADAPTER_MODE=local|remote`.
- Add dashboard configuration for `CMO_REMOTE_ADAPTER_URL`.
- Add dashboard configuration for `CMO_REMOTE_ADAPTER_API_KEY`.
- Keep the Windows dashboard disconnected from direct OpenClaw Gateway calls.
- Document that direct Gateway trigger API is not yet a stable dashboard contract.

### Phase 4B: Dashboard Remote Adapter Client

Status: implemented.

- Update dashboard server-side CMO adapter code to support `local` and `remote` modes.
- In `local` mode, keep the existing JSON/mock behavior.
- In `remote` mode, call the VPS Adapter API.
- Proxy or map `POST /cmo/run-brief`, `GET /cmo/runs/:runId`, `GET /cmo/latest`, and `GET /cmo/status` through existing dashboard API boundaries where useful.
- Implement timeout handling for remote HTTPS calls.
- Keep secrets server-side only.

### Phase 4C: VPS Adapter Service Skeleton

Status: implemented as a mock/skeleton service. Real OpenClaw trigger wiring remains planned for Phase 5.

- Add a VPS-side service that exposes `POST /cmo/run-brief`, `GET /cmo/runs/:runId`, `GET /cmo/latest`, and `GET /cmo/status`.
- Authenticate requests with `CMO_ADAPTER_API_KEY`.
- Configure `OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789`.
- Configure `CMO_DASHBOARD_DATA_DIR=/home/ju/.openclaw/workspace/data/cmo-dashboard`.
- Serve normalized JSON only.
- Keep raw OpenClaw output private except for operator debugging.
- Keep OpenClaw Gateway private and loopback-only.

### Phase 5A: OpenClaw CMO Trigger Scaffold

Status: implemented as a VPS Adapter scaffold.

- Add `CMO_TRIGGER_MODE=mock|openclaw-cron`, defaulting to `mock`.
- Keep mock mode as the local development and recovery path.
- Add a VPS-only `openclaw-cron` path in `services/vps-cmo-adapter/server.mjs`.
- Trigger `agentId: "cmo"` through local `openclaw cron add` and `openclaw cron run` calls using Node child process argument arrays.
- Use `sessionTarget: "isolated"`.
- Use `payload.kind: "agentTurn"`.
- Use delivery mode `none`.
- Write an initial normalized run with `status: "running"` to `/home/ju/.openclaw/workspace/data/cmo-dashboard/runs/{runId}.json`.
- Update `/home/ju/.openclaw/workspace/data/cmo-dashboard/latest.json` when the run starts and when trigger metadata or failure state is available.
- Prompt CMO to write raw markdown to `/home/ju/.openclaw/workspace/data/cmo-dashboard/raw/{runId}.md`.
- Prompt CMO to write normalized dashboard JSON to `/home/ju/.openclaw/workspace/data/cmo-dashboard/runs/{runId}.json`.
- Preserve `latest_successful.json` on trigger failures.
- Keep OpenClaw Gateway loopback-only and private.
- Keep the Windows dashboard disconnected from direct OpenClaw calls.

### Phase 5B: OpenClaw Output Polling And Validation

Status: implemented for read-time finalization and safe metadata.

- Finalize CMO-written normalized JSON from `GET /cmo/runs/:runId`.
- Make `GET /cmo/latest` attempt finalization when `latest.json` still points at a running run.
- Validate completed output against the dashboard contract before serving it as completed.
- Promote valid completed output to `latest.json` and `latest_successful.json`.
- Promote timed-out runs to `status: "timeout"` and preserve the previous `latest_successful.json`.
- Return invalid completed output as `status: "partial"` with validation error metadata and preserve the previous `latest_successful.json`.
- Keep public OpenClaw metadata sanitized to `mode`, `agent_id`, `job_id`, `job_name`, `schedule_at`, `openclaw_run_id`, `trigger_status`, `raw_markdown_path`, `normalized_json_path`, and `spec_path`.
- Preserve full CLI stdout/stderr only in private `status/{runId}.debug.json`.
- Planned follow-up: add trigger/result fixtures from real OpenClaw runs.
- Planned follow-up: add adapter tests for failed, partial, timeout, and invalid normalized output.

### Phase 5C: Completed Output Normalization Before Validation

Status: implemented for VPS Adapter finalization and CMO prompt guidance.

- Repair sparse completed CMO-written nested dashboard arrays before validation.
- Normalize `actions`, `signals`, `agents`, `campaigns`, `reports`, and `vault`.
- Ensure nested `schema_version: "cmo.dashboard.v1"` and stable IDs derived from item type, index, and title or name.
- Fill missing card fields with safe defaults so useful completed CMO output is not marked partial solely because nested objects are sparse.
- Map agent `metric_a` and `metric_b` from snake_case CMO-authored JSON into the dashboard UI fields.
- Keep strict validation after normalization; still-invalid output remains `partial` with concise `validation_errors`.
- Expand the CMO prompt with explicit nested object examples and require every nested item to include `id`.
- Keep `CMO_TRIGGER_MODE=mock` as the default and keep OpenClaw Gateway private.

### Phase 6: Validation Hardening

Planned.

- Add stricter schema validation.
- Add migration support for future `schema_version` values.
- Add unit tests for malformed, partial, and legacy payloads.

### Phase 7: Realtime Updates

Planned.

- Add SSE endpoint.
- Add run status events.
- Add dashboard subscription.
- Refresh dashboard sections after completion.

### Phase 8: Production Persistence

Planned.

- Replace local JSON writes with durable storage if needed.
- Keep the CMO Adapter contract stable.
- Preserve local JSON mode for development and recovery.
