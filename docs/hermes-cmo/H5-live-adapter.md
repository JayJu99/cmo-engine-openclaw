# Phase H5 - Real Hermes CMO Live Adapter

Status: live adapter boundary  
Scope: Hermes CMO Agent endpoint only  
Runtime status: not wired into live CMO chat

## Purpose

H5 replaces the H4 skeleton response with a live-only adapter behind the same entrypoint:

```ts
runHermesCmoRuntime(request)
```

The adapter validates an incoming `hermes.cmo.request.v1` request, builds an outbound H5 live request, calls the Hermes CMO Agent endpoint, validates the returned `hermes.cmo.response.v1` response and `hermes.activity.event.v1` activity events, and returns the live result.

## Live-Only Boundary

H5 has no dry-run mode, mock runtime response, or silent fallback.

Required live config:

- `CMO_HERMES_EXECUTION_ENABLED=true`
- `CMO_HERMES_BASE_URL`
- `CMO_HERMES_API_KEY`

The adapter always posts to:

```txt
{CMO_HERMES_BASE_URL}/agents/cmo/execute
```

If the live config is missing, the endpoint returns non-2xx, the response is not valid JSON, or the response violates the Hermes CMO contract, H5 fails clearly.

## Sub-Agent and Write Boundary

H5 calls only Hermes CMO Agent.

H5 does not call or wire:

- Surf
- Echo
- Vault Agent
- Vault writers
- Supabase mutations
- session JSON writers
- raw capture writers
- OpenClaw runtime
- Kanban
- `src/lib/cmo/runtime.ts`

Before the live call, the adapter enforces the H5 outbound runtime policy:

- `constraints.allowed_agents = []`
- `constraints.allowed_surf_modes = []`
- `constraints.vault_agent_delegation_allowed = false`
- `constraints.kanban_enabled = false`
- `constraints.h5_live_adapter.sub_agent_execution_allowed = false`
- write permissions remain false

This keeps Surf/Echo/Vault Agent delegation disabled for H5. A future phase can explicitly re-enable proposal-only delegation or real sub-agent execution with a separate contract decision.

## Response Validation

The live Hermes CMO response must satisfy:

- `schema_version = hermes.cmo.response.v1`
- request/session/turn ids mirror the outbound request
- status is one of the CMO response contract values
- answer basis and clarification state are valid
- `needs_user_input` responses have `answer = null`, `structured_output = null`, and `clarifying_question.required = true`
- `assumption_based` responses include missing inputs and assumptions
- direct Vault or memory mutation flags are not present as true
- delegations are empty or explicitly non-executed proposals
- activity summary count matches returned activity events
- activity events are emitted by CMO only and do not include executed delegation event types

## Safety Counters

The adapter result reports:

```txt
mode: live
calledHermesCmo: true
surfCalls: 0
echoCalls: 0
vaultAgentCalls: 0
vaultWrites: 0
supabaseWrites: 0
sessionJsonWrites: 0
rawCaptureWrites: 0
openclawCalls: 0
```

These counters are adapter boundary counters. They mean H5 itself only called Hermes CMO Agent and did not call or write through any other local runtime path.

## Checks

Run:

```bash
npm run lint
npm run build
node scripts/cmo-hermes-cmo-runtime-check.mjs
node scripts/cmo-hermes-cmo-live-adapter-check.mjs
```

The live adapter check starts a local HTTP contract server, points the live config at it, and proves the runtime performs a real POST to `/agents/cmo/execute`. The runtime itself has no mock response or fallback path.
