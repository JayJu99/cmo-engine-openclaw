# Phase H2 — Hermes CMO Agent Skeleton

Status: draft skeleton  
Scope: agent-facing docs, prompts, policies, schemas, and local validation only  
Runtime status: not wired, not runnable as a live agent  
Last updated: 2026-05-28

## 1. Purpose

Phase H2 makes the Hermes CMO Agent shape concrete without connecting it to live CMO Engine runtime.

H2 creates the non-runtime CMO and Vault Agent skeletons, future system prompts, operational policies, schema drafts, and validation scaffolding needed for a later dry-run/runtime phase.

The H2 output is safe documentation and contract validation only. It does not execute Hermes CMO, Echo, Surf, or Vault Agent.

## 2. H1 Dependency

H2 depends on the H1 contracts in `docs/hermes-cmo/`.

H1 locked these boundaries:

- CMO Hermes is the strategic brain, orchestrator, and reviewer.
- Echo is the content and final-copy executor.
- Surf is the research, evidence, signal, trend, and pulse executor.
- `surf.x`, `surf.trend`, and `surf.pulse` are Surf modes, not separate agents.
- Vault Agent is the delegated Vault writer only when explicit save intent exists.
- CMO cannot write Vault directly.
- CMO cannot mutate memory directly.
- CMO Engine still owns session save, raw capture, Supabase index, UI state, and current session persistence.
- H1 did not implement runtime behavior.

## 3. Non-goals

H2 does not:

- Modify live CMO Engine behavior.
- Wire CMO Engine to Hermes CMO.
- Implement live delegation calls to Echo, Surf, or Vault Agent.
- Implement actual Vault writing.
- Modify Supabase indexing.
- Modify session save.
- Modify raw capture.
- Modify OpenClaw runtime.
- Modify Kanban.
- Add runnable Hermes agent runtime directories.

## 4. Files Created

H2 creates these documentation-safe skeleton files:

- `docs/hermes-cmo/H2-hermes-cmo-agent-skeleton.md`
- `docs/hermes-cmo/agents/cmo/README.md`
- `docs/hermes-cmo/agents/cmo/agent.md`
- `docs/hermes-cmo/agents/cmo/system.prompt.md`
- `docs/hermes-cmo/agents/cmo/intake.policy.md`
- `docs/hermes-cmo/agents/cmo/orchestration.policy.md`
- `docs/hermes-cmo/agents/cmo/clarifying-assumption.policy.md`
- `docs/hermes-cmo/agents/cmo/evidence.policy.md`
- `docs/hermes-cmo/agents/cmo/activity-stream.policy.md`
- `docs/hermes-cmo/agents/cmo/delegation.policy.md`
- `docs/hermes-cmo/agents/cmo/reviewer.policy.md`
- `docs/hermes-cmo/agents/vault-agent/README.md`
- `docs/hermes-cmo/agents/vault-agent/agent.md`
- `docs/hermes-cmo/agents/vault-agent/system.prompt.md`
- `docs/hermes-cmo/agents/vault-agent/vault-write.policy.md`
- `docs/hermes-cmo/agents/vault-agent/save-intent.policy.md`
- `docs/hermes-cmo/schemas/cmo-request.schema.json`
- `docs/hermes-cmo/schemas/cmo-response.schema.json`
- `docs/hermes-cmo/schemas/activity-event.schema.json`
- `docs/hermes-cmo/schemas/delegation.schema.json`
- `docs/hermes-cmo/schemas/echo-request.schema.json`
- `docs/hermes-cmo/schemas/surf-request.schema.json`
- `docs/hermes-cmo/schemas/vault-agent-request.schema.json`
- `docs/hermes-cmo/scripts-notes/README.md`
- `scripts/validate-hermes-cmo-h2.mjs`

## 5. CMO Agent Skeleton

CMO Agent skeleton files live under `docs/hermes-cmo/agents/cmo/`.

The CMO agent definition is a future manifest draft, not executable code. It defines:

- Agent name: `cmo`
- Role: strategic brain, orchestrator, and reviewer
- Input: `hermes.cmo.request.v1`
- Output: `hermes.cmo.response.v1`
- Events: `hermes.activity.event.v1`
- Allowed delegations: Echo, Surf, Vault Agent
- Forbidden actions: direct Vault write, direct memory mutation, direct Supabase mutation, session save mutation, raw capture mutation, direct publishing, unsupported claim generation, and chain-of-thought exposure

## 6. CMO System Prompt

The CMO system prompt is drafted in `docs/hermes-cmo/agents/cmo/system.prompt.md`.

It is written as a future real system prompt, but H2 does not load or execute it. It establishes CMO as a strategic C-level operator that owns diagnosis, decision framing, clarifying questions, assumption disclosure, delegation planning, final synthesis, and review of delegated outputs.

## 7. CMO Intake Policy

The intake policy classifies user requests into:

- `strategy_only`
- `needs_clarification`
- `assumption_based_strategy`
- `needs_surf`
- `needs_echo`
- `needs_surf_then_echo`
- `needs_vault_agent`
- `mixed_workflow`

This policy exists only as a routing contract for future implementation.

## 8. Clarifying + Assumption Policy

CMO must ask a focused clarifying question when missing information blocks a reliable answer.

When missing information does not fully block progress, CMO may continue only after disclosing:

- What is missing.
- What assumption is being used.
- How the assumption affects the answer.
- What the user can provide to improve or override the assumption.

## 9. Orchestration Policy

CMO owns final synthesis.

Surf returns evidence, not final strategy. Echo returns copy artifacts, not strategic decisions. Vault Agent writes only when explicit save intent exists.

CMO should emit activity events for run start, context loaded, assumption notice, clarification required, delegation created, delegation waiting, delegation completed, artifact created, memory suggestion created, and run completed.

## 10. Evidence Policy

CMO separates verified facts, weak signals, assumptions, and unknowns.

X/social signal is treated as weak signal unless stronger evidence supports it. CMO must not allow Echo to use claims outside claim boundaries. Unsupported or uncertain claims must be marked, and Surf should be requested when current, recent, or niche evidence is required.

## 11. Activity Stream Policy

Activity Stream is user-visible operational state.

It is not private chain-of-thought, a reasoning transcript, or a debug dump. H2 defines approved and disallowed message examples for future UI-safe observability.

## 12. Delegation Policy

Allowed delegation targets:

- `echo`
- `surf`
- `vault_agent`

Allowed Surf modes:

- `surf.default`
- `surf.x`
- `surf.trend`
- `surf.pulse`

Required delegation metadata:

- `delegation_id`
- `parent_request_id`
- `parent_session_id`
- `target.agent`
- `target.mode`
- `objective`
- `input.brief`
- `input.context`
- `input.constraints`
- `expected_output`

## 13. Reviewer Policy

Before final response, CMO reviews delegated outputs for evidence support, claim boundaries, disclosed assumptions, surfaced missing inputs, explicit Vault save intent, and concise dashboard-friendly strategy.

## 14. Vault Agent Skeleton

Vault Agent skeleton files live under `docs/hermes-cmo/agents/vault-agent/`.

Vault Agent is not implemented as a live writer in H2. This skeleton only defines the future delegated writer boundary.

Vault Agent role:

- Vault Agent is the dedicated Vault writer.
- CMO cannot write Vault directly.
- CMO may call Vault Agent only when explicit save intent exists.

H2 scope:

- `vault.write` contract only
- no `vault.read`
- no `vault.search`
- no `vault.promote`
- no live file writes

## 15. Vault Agent Save Intent Policy

Valid save intent includes explicit user save language, explicit save actions, and user confirmation of a save prompt.

Non-save memory-worthy content produces `memory_suggestion`, not Vault Agent delegation.

## 16. Schema Validation

H2 schema drafts live under `docs/hermes-cmo/schemas/`.

They cover:

- `hermes.cmo.request.v1`
- `hermes.cmo.response.v1`
- `hermes.activity.event.v1`
- `hermes.delegation.request.v1`
- `hermes.echo.request.v1`
- `hermes.surf.request.v1`
- `hermes.vault_agent.request.v1`

The local script `scripts/validate-hermes-cmo-h2.mjs` parses all JSON examples in `docs/hermes-cmo/examples/`, parses all JSON schemas in `docs/hermes-cmo/schemas/`, validates expected `schema_version` values, and validates `activity-stream.jsonl` line by line.

It does not call external APIs, start agents, write Vault, mutate Supabase, or modify runtime state.

## 17. Future H3 Boundary

H3 should be:

```txt
H3 — Local Contract Adapter / Dry-run Runner
```

H3 can create a dry-run function that accepts a sample CMO request and produces a mock CMO response plus activity events.

H3 still should not call live Echo, Surf, or Vault Agent unless explicitly approved later.

## 18. Acceptance Criteria

H2 is complete when:

- H2 spec exists.
- CMO Agent skeleton docs exist.
- CMO system prompt exists.
- CMO intake, orchestration, evidence, activity, delegation, and reviewer policies exist.
- Vault Agent skeleton docs exist.
- Save intent policy exists.
- JSON schemas exist for H1 contracts.
- Existing H1 examples still parse.
- Optional H2 validation script passes if created.
- `npm run lint` passes.
- `npm run build` passes.
- No live runtime behavior changed.
- No CMO Engine runtime integration added.
- No Vault writing implementation added.
- No Supabase, session, or raw capture behavior changed.
- No Kanban implementation added.

