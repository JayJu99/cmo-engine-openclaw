# Phase H6 - CMO Engine Live Chat to Hermes CMO

Status: feature-flagged live chat wiring
Scope: app-chat routing, request/response mapping, guardrail validation, and fallback to the existing CMO chat path
Runtime status: disabled by default

## Purpose

H6 wires CMO Engine app chat to the H5 `runHermesCmoRuntime(request)` boundary for canary apps only. CMO Engine continues to own context resolution, UI state, session JSON persistence, raw capture, Supabase indexing, and Vault writes.

Hermes CMO is used only as the reasoning/answer/proposal layer. It does not execute Surf, Echo, Vault Agent, OpenClaw, or local write paths.

## Feature Flags

```txt
CMO_HERMES_CMO_CHAT_ENABLED=false
CMO_HERMES_CMO_CANARY_APPS=holdstation-mini-app
```

`CMO_HERMES_CMO_CHAT_ENABLED` defaults to disabled. `CMO_HERMES_CMO_CANARY_APPS` is parsed as a comma-separated app id list.

The H5 live adapter config is still required when the H6 route is enabled:

```txt
CMO_HERMES_EXECUTION_ENABLED=true
CMO_HERMES_BASE_URL=
CMO_HERMES_API_KEY=
```

## Routing Matrix

| Flag | App | Route |
|---|---|---|
| off | any app | Existing CMO chat path. Hermes CMO is not called. |
| on | `holdstation-mini-app` | Build `hermes.cmo.request.v1`, call `runHermesCmoRuntime`, map response to app-chat shape. |
| on | non-canary app | Existing CMO chat path. Hermes CMO is not called. |
| on | canary, Hermes fails | Existing CMO chat path, with `hermesCmoStatus` metadata set to fallback status. |

`forceFallback` keeps its existing behavior and does not route to Hermes CMO.

## Ownership Boundary

CMO Engine remains owner of:

- Session JSON writes
- Raw capture and Vault writes
- Supabase indexing
- UI state
- App workspace context
- Existing fallback and OpenClaw runtime path

Hermes CMO may return:

- Reasoning-safe answer content
- Structured recommendations
- Delegation proposals
- Memory suggestions
- Activity metadata

Hermes CMO must not mutate memory, write Vault, write Supabase, write session JSON, write raw capture, call OpenClaw, or execute Surf/Echo/Vault Agent.

## Guardrails

The H6 mapper sends an explicit read-only snapshot and these execution/write guardrails:

```txt
allowSubAgentExecution=false
allowSurfExecution=false
allowEchoExecution=false
allowVaultAgentExecution=false
allowVaultWrites=false
allowSupabaseWrites=false
allowSessionWrites=false
allowRawCaptureWrites=false
allowOpenClawCalls=false
delegations_mode=proposals_only
```

After Hermes returns, H6 validates required zero counters:

- `surfCalls`
- `echoCalls`
- `vaultAgentCalls`
- `vaultWrites`
- `supabaseWrites`
- `sessionJsonWrites`
- `rawCaptureWrites`
- `openclawCalls`

Any missing, invalid, or non-zero forbidden counter is treated as a guardrail violation. CMO Engine falls back to the existing chat path and records safe metadata:

```txt
hermesCmoStatus=guardrail_violation_then_existing_fallback
hermesCmoErrorReason=<safe reason>
```

Other Hermes failures use:

```txt
hermesCmoStatus=failed_then_existing_fallback
hermesCmoErrorReason=<safe reason>
```

## Validation Commands

```bash
npm run lint
npm run build
node scripts/cmo-hermes-cmo-chat-wiring-check.mjs
node scripts/cmo-hermes-cmo-runtime-check.mjs
node scripts/cmo-hermes-cmo-live-adapter-check.mjs
npm run smoke:cmo-fallback
npm run smoke:cmo-live-app-turn
```

## Rollback Plan

Set:

```txt
CMO_HERMES_CMO_CHAT_ENABLED=false
```

With the flag off, app chat uses the existing CMO chat path and does not call Hermes CMO. The code path is also canary-limited by `CMO_HERMES_CMO_CANARY_APPS`, so removing an app id from the canary list rolls that app back without code changes.
