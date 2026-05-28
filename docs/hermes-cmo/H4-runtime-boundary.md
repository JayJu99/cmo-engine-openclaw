# Phase H4 - Lean Hermes CMO Runtime Skeleton Boundary

Status: skeleton runtime boundary  
Scope: one runtime entrypoint, one local smoke check, and this short doc  
Runtime status: not wired into live CMO chat

## Purpose

H4 creates the first lean runtime entrypoint for Hermes CMO without enabling live orchestration.

The entrypoint is `runHermesCmoRuntime(request)` in `src/lib/cmo/hermes-cmo-runtime.ts`. It accepts a Hermes CMO request compatible with the H2/H3 `hermes.cmo.request.v1` contract and returns a deterministic `hermes.cmo.response.v1` response plus `hermes.activity.event.v1` activity events.

## Boundary

Runtime mode is always `skeleton`.

H4 performs no external agent calls and no writes:

- Surf calls: `0`
- Echo calls: `0`
- Vault Agent calls: `0`
- Vault writes: `0`
- Supabase writes: `0`
- Session writes: `0`
- Raw capture writes: `0`
- OpenClaw calls: `0`

H4 is not wired into `src/lib/cmo/runtime.ts`, live CMO chat, OpenClaw runtime, Surf, Echo, Vault Agent, Vault, Supabase, session persistence, raw capture, UI state, or Kanban.

## Check

Run:

```bash
node scripts/cmo-hermes-cmo-runtime-check.mjs
```

The check builds a minimal valid request, runs the skeleton runtime, validates the response and activity shape, verifies `runtimeMode === "skeleton"`, and asserts all external call and write counters are `0`.

## H5 Direction

H5 can move toward a real Hermes CMO live adapter behind this boundary. That later phase should explicitly decide how to call Surf, Echo, and Vault Agent, and how to keep CMO Engine ownership of session save, raw capture, Supabase index, UI state, and Vault writes safe.
