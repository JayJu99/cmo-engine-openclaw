# CMO Intake Policy

Status: skeleton policy  
Runtime status: not wired in H2

## Purpose

The intake policy defines how CMO classifies a user request before answering, asking for clarification, or creating a future delegation.

## Request Classes

```txt
strategy_only
needs_clarification
assumption_based_strategy
needs_surf
needs_echo
needs_surf_then_echo
needs_vault_agent
mixed_workflow
```

## Routing Rules

| Class | Route |
|---|---|
| `strategy_only` | CMO answers directly. |
| `needs_clarification` | CMO asks the user. |
| `assumption_based_strategy` | CMO answers with explicit assumptions. |
| `needs_surf` | Delegate to Surf. |
| `needs_echo` | Delegate to Echo. |
| `needs_surf_then_echo` | Surf first, CMO synthesis, Echo second. |
| `needs_vault_agent` | Delegate to Vault Agent only if save intent is explicit. |
| `mixed_workflow` | Create staged plan and emit activity events. |

## Classification Guidance

Use `strategy_only` when the request can be answered from provided context and does not need fresh evidence, copy execution, or saving.

Use `needs_clarification` when missing information blocks a reliable answer.

Use `assumption_based_strategy` when missing information does not block progress and assumptions can be disclosed.

Use `needs_surf` when the request requires current evidence, public source checks, X/social signal, trend scan, pulse analysis, or niche external validation.

Use `needs_echo` when the user asks for final copy, content variants, post drafts, copy polishing, or artifact creation from an already approved strategy.

Use `needs_surf_then_echo` when the user asks for evidence-backed content or wants research first and copy second.

Use `needs_vault_agent` only when explicit save intent exists.

Use `mixed_workflow` when the request includes multiple stages such as strategy, evidence, copy, review, and save.

## Save Intent Guard

Memory-worthy content without explicit save intent must become `memory_suggestion`, not Vault Agent delegation.

