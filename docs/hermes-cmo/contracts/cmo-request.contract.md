# CMO Request Contract

Schema version: `hermes.cmo.request.v1`  
Status: draft contract  
Runtime status: spec only, not runnable yet

## Purpose

The CMO request is the CMO Engine to Hermes CMO boundary. CMO Engine resolves workspace context and persistence-adjacent inputs before calling Hermes CMO. Hermes CMO uses this request to reason, ask clarification, answer directly, or create bounded delegations.

```txt
CMO Engine resolves context.
Hermes CMO reasons and orchestrates.
CMO Engine still saves session/raw/index as current system behavior.
```

## Required Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.cmo.request.v1`. |
| `request_id` | string | yes | Unique CMO request id. |
| `session_id` | string | yes | Current CMO session id. |
| `turn_id` | string | yes | Current user turn id. |
| `created_at` | string | yes | ISO-8601 timestamp with offset. |
| `workspace` | object | yes | Workspace/app identity. |
| `user` | object | yes | Server-derived user identity. |
| `intent` | object | yes | User message and CMO mode. |
| `context_pack` | object | yes | Context resolved by CMO Engine. |
| `constraints` | object | yes | Runtime and policy boundaries. |
| `ui` | object | yes | Activity Stream and Heartbeat requirements. |
| `tool_policy` | object | recommended | Product-shell tool/delegation/write boundary. |
| `product_boundary` | object | recommended | CMO Engine / Hermes CMO / Vault Agent ownership invariant. |
| `source_acquisition` | object | recommended | Chat source cache role and official ingestion boundary. |
| `runtime_context` | object | recommended | Server-derived time, locale, timezone, and user display context. |

## Canonical Shape

```json
{
  "schema_version": "hermes.cmo.request.v1",
  "request_id": "req_20260528_001",
  "session_id": "session_abc",
  "turn_id": "turn_abc",
  "created_at": "2026-05-28T10:00:00+07:00",
  "workspace": {
    "workspace_id": "world-app-holdstation-mini-app",
    "app_id": "holdstation-mini-app",
    "app_name": "Holdstation Mini App"
  },
  "user": {
    "user_id": "server_derived_user_id",
    "display_name": "Jay"
  },
  "intent": {
    "mode": "cmo.default",
    "user_message": "Review plan này giúp mình",
    "explicit_command": null
  },
  "context_pack": {
    "current_priority": [],
    "selected_context": [],
    "recent_session_summary": null,
    "indexed_context_supplement": [],
    "artifacts_in": []
  },
  "constraints": {
    "no_direct_vault_write": true,
    "no_direct_memory_mutation": true,
    "vault_agent_delegation_allowed": true,
    "vault_agent_requires_save_intent": true,
    "kanban_enabled": false,
    "demo_mode": true,
    "allowed_agents": ["echo", "surf", "vault_agent"],
    "allowed_surf_modes": [
      "surf.default",
      "surf.x",
      "surf.trend",
      "surf.pulse"
    ]
  },
  "ui": {
    "activity_stream_required": true,
    "heartbeat_required": true
  },
  "tool_policy": {
    "schema_version": "cmo.hermes.tool_policy.v1",
    "role": "product_shell_context_provider",
    "allowed_agents": ["echo", "surf"],
    "delegations_mode": "proposals_only",
    "read_web_allowed": true,
    "read_browser_allowed": true,
    "read_file_allowed": true,
    "terminal_read_only_allowed": true,
    "durable_writes_require_confirmation": true,
    "allowed_toolsets": ["web", "browser", "file", "terminal_read_only", "code_execution", "vision", "skills", "session_search", "clarify", "todo", "memory_read", "delegation"],
    "disabled_toolsets": ["messaging", "cronjob", "kanban"],
    "durable_writes": {
      "session_log_owned_by_cmo_engine": true,
      "vault_writes_require_explicit_save_flow": true,
      "source_ingestion_requires_inputs_priorities_or_explicit_save": true,
      "no_auto_save_13_sources": true,
      "no_auto_promote_12_knowledge": true,
      "no_gbrain_mutation": true
    }
  }
}
```

## Field Notes

`intent.mode` is always `cmo.default` for live M1 compatibility. An explicit `/goal` weekly campaign request is identified by the exact `workflow` envelope described below, not by a separate intent mode.

`workflow` is allowed only with `intent.mode: cmo.default` and `intent.explicit_command: /goal`. Its contract is `cmo.weekly_campaign_workflow.v1`, with the fixed stages `lens`, `surf`, `echo`, and `cmo_synthesis`; it must require the Lens measurement, Surf research, Echo content, and weekly campaign-pack artifacts. Every specialist policy is `required_if_available`. Ordinary `cmo.default` chat must omit this envelope.

`intent.explicit_command` captures a parsed explicit command when available. Null means CMO should infer route from the user message and context, while still following the Clarifying + Assumption Protocol.

`context_pack.current_priority` contains high-priority context already selected by CMO Engine.

`context_pack.selected_context` contains user-selected or UI-selected context for the current turn.

`context_pack.recent_session_summary` contains a compact summary when available.

`context_pack.indexed_context_supplement` contains resolved indexed context. Hermes CMO must not fetch or mutate the index directly in H1.

`context_pack.artifacts_in` contains incoming artifacts that CMO may inspect or cite.

`constraints.allowed_agents` limits all CMO delegations. H1 allowed values are `echo`, `surf`, and `vault_agent`.

`constraints.allowed_surf_modes` makes Surf modes explicit. `surf.x`, `surf.trend`, and `surf.pulse` are modes, not agents.

`tool_policy` allows Hermes CMO to be the primary read-only source reader in chat. It may decide whether to use web/browser/file/read-only terminal/source tools, while durable writes still require explicit user approval and approved product flows.

## Invariants

- CMO must not write Vault directly.
- CMO must not mutate memory directly.
- CMO may delegate to Vault Agent only when explicit save intent exists.
- CMO may emit `memory_suggestion` records in the response.
- CMO must respect allowed agents and Surf modes.
- CMO must not assume Kanban is available when `kanban_enabled` is false.
- CMO Engine remains responsible for session save, raw capture, Supabase index, UI state, and current session persistence.
- When Hermes CMO is live, CMO Engine may cache source artifacts but must not synthesize final source-review or source-answer output.
- Chat URL/file acquisition is session-local context only; official `13 Sources` ingestion requires the future Inputs & Priorities / Sources UI or an explicit save flow.
