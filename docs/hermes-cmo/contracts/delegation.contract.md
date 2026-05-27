# Delegation Contract

Schema version: `hermes.delegation.request.v1`  
Status: draft contract  
Runtime status: spec only, not runnable yet

## Purpose

The common delegation contract describes how CMO requests bounded work from execution agents. It is the generic envelope used before mapping to Echo, Surf, or Vault Agent specific contracts.

CMO delegates work only when a bounded execution agent is better suited than direct strategic response.

## Allowed Targets

```txt
echo
surf
vault_agent
```

## Allowed Surf Modes

```txt
surf.default
surf.x
surf.trend
surf.pulse
```

Trend, Pulse, and Surf X are modes under Surf, not separate agents.

## Common Request

```json
{
  "schema_version": "hermes.delegation.request.v1",
  "delegation_id": "del_001",
  "parent_request_id": "req_20260528_001",
  "parent_session_id": "session_abc",
  "target": {
    "agent": "surf",
    "mode": "surf.x"
  },
  "objective": "Find current X discussion signals around Holdstation Mini App activation.",
  "input": {
    "brief": "CMO needs evidence before forming a recommendation.",
    "context": [],
    "constraints": []
  },
  "expected_output": {
    "format": "structured_json",
    "required_sections": [
      "verified_facts",
      "weak_signals",
      "assumptions",
      "unknowns",
      "claim_boundaries"
    ]
  }
}
```

## Required Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.delegation.request.v1`. |
| `delegation_id` | string | yes | Unique delegation id. |
| `parent_request_id` | string | yes | Parent CMO request id. |
| `parent_session_id` | string | yes | Parent session id. |
| `target` | object | yes | Target agent and optional mode. |
| `objective` | string | yes | Bounded objective. |
| `input` | object | yes | Brief, context, and constraints. |
| `expected_output` | object | yes | Required shape and sections. |

## Routing Rules

| Need | Target |
|---|---|
| Strategy-only answer | No delegation. |
| Research, evidence, sources, trend, pulse, or social signal | Surf. |
| X/social signal | Surf with `mode: "surf.x"`. |
| Trend scan | Surf with `mode: "surf.trend"`. |
| Pulse analysis | Surf with `mode: "surf.pulse"`. |
| Content or final copy | Echo. |
| Research then content | Surf, then CMO synthesis, then Echo. |
| Explicit save intent | Vault Agent with `mode: "vault.write"`. |

## Invariants

- CMO owns final strategic synthesis.
- Delegated agents do not mutate CMO memory.
- Delegated agents do not write Vault except Vault Agent in `vault.write` mode.
- Vault Agent delegation requires explicit save intent.
- Delegations must be represented in the CMO response and Activity Stream.

