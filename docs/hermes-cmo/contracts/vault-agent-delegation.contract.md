# Vault Agent Delegation Contract

Schema versions:

```txt
hermes.vault_agent.request.v1
hermes.vault_agent.response.v1
```

Status: draft contract  
Runtime status: spec only, not runnable yet

## Purpose

Vault Agent is the delegated Vault writer. During H1/H2, only `vault.write` is in scope. CMO cannot write Vault directly and cannot mutate memory directly.

Future possible modes such as `vault.read`, `vault.search`, and `vault.promote` are out of scope for H1.

## Request Example

```json
{
  "schema_version": "hermes.vault_agent.request.v1",
  "delegation_id": "del_vault_agent_001",
  "parent_request_id": "req_001",
  "parent_session_id": "session_abc",
  "mode": "vault.write",
  "save_intent": {
    "source": "user_explicit_request",
    "evidence": "User said: lưu lại cái này"
  },
  "content": {
    "type": "architecture_decision",
    "title": "CMO can delegate Vault writes to Vault Agent",
    "body": "CMO does not write Vault directly, but may call Vault Agent when save intent is explicit."
  },
  "write_policy": {
    "direct_write_by_cmo": false,
    "vault_agent_required": true,
    "requires_confirmation": false
  }
}
```

## Response Example

```json
{
  "schema_version": "hermes.vault_agent.response.v1",
  "delegation_id": "del_vault_agent_001",
  "status": "completed",
  "result": {
    "write_confirmed": true,
    "vault_location": "architecture-decisions/cmo-vault-agent-rule.md",
    "summary": "Saved architecture decision about CMO delegating Vault writes to Vault Agent."
  }
}
```

## Request Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.vault_agent.request.v1`. |
| `delegation_id` | string | yes | Parent delegation id. |
| `parent_request_id` | string | yes | Parent CMO request id. |
| `parent_session_id` | string | yes | Parent session id. |
| `mode` | string | yes | H1/H2 allowed value is `vault.write`. |
| `save_intent` | object | yes | Explicit save intent evidence. |
| `content` | object | yes | Content proposed for writing. |
| `write_policy` | object | yes | Direct-write and confirmation policy. |

## Response Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.vault_agent.response.v1`. |
| `delegation_id` | string | yes | Mirrors request. |
| `status` | string | yes | Completed, partial, failed, or cancelled. |
| `result` | object | yes | Write confirmation and location. |

## Save Intent

Save intent must be explicit. Examples:

- User says "save this".
- User says "lưu lại cái này".
- User clicks an explicit save action.
- User confirms a save prompt.

Non-save examples:

- CMO thinks content is memory-worthy.
- CMO produces an architecture recommendation.
- Surf returns useful evidence.
- Echo returns useful copy.

Those non-save examples may produce `memory_suggestion`, not Vault Agent write delegation.

## Rules

```txt
CMO cannot write Vault directly.
CMO can delegate to Vault Agent when save intent is explicit.
Weak memory-worthy content should become memory_suggestion only.
```

Additional rules:

- `write_policy.direct_write_by_cmo` must be false.
- `write_policy.vault_agent_required` must be true.
- Vault Agent delegation must emit `vault_agent.delegation.*` activity events.
- CMO Engine session/raw/index persistence remains outside this contract.

