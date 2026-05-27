# Hermes CMO Agent Skeleton

This is a non-runtime Hermes CMO Agent skeleton.
It is not wired to live CMO Engine runtime.
It does not call Echo, Surf, or Vault Agent yet.
It does not write Vault.
It does not mutate memory.
It follows H1 contracts.

Runtime implementation is out of scope for H2. These files define the future agent-facing boundary, prompt, policies, and validation shape only.

## Agent Map

```txt
CMO Hermes
├─ Echo
├─ Surf
│  ├─ surf.default
│  ├─ surf.x
│  ├─ surf.trend
│  └─ surf.pulse
└─ Vault Agent
   └─ vault.write only when save intent exists
```

## Files

- `agent.md` defines the future agent manifest shape.
- `system.prompt.md` drafts the future CMO system prompt.
- `intake.policy.md` defines request classification.
- `clarifying-assumption.policy.md` defines missing-context handling.
- `orchestration.policy.md` defines delegation flow ownership.
- `evidence.policy.md` defines evidence and claim discipline.
- `activity-stream.policy.md` defines user-visible operational events.
- `delegation.policy.md` defines allowed delegation targets and metadata.
- `reviewer.policy.md` defines CMO review checks before final response.

## Boundary

CMO Hermes is the strategic brain, orchestrator, and reviewer. CMO Engine still owns context resolution, session save, raw capture, Supabase indexing, UI state, and current session persistence.

