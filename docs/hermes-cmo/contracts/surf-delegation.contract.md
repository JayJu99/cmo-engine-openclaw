# Surf Delegation Contract

Schema versions:

```txt
hermes.surf.request.v1
hermes.surf.response.v1
```

Status: draft contract  
Runtime status: spec only, not runnable yet

## Purpose

Surf is the research, evidence, source, social signal, trend, and pulse executor. Surf modes are execution modes under the Surf agent, not separate agents.

Allowed modes:

```txt
surf.default
surf.x
surf.trend
surf.pulse
```

## Request Example

```json
{
  "schema_version": "hermes.surf.request.v1",
  "delegation_id": "del_surf_001",
  "mode": "surf.x",
  "task": {
    "type": "social_signal_scan",
    "objective": "Analyze X discussion around Holdstation Mini App activation.",
    "questions": [
      "What are users reacting to?",
      "What pain points or hooks appear repeatedly?",
      "What claims are safe for Echo to use?"
    ]
  },
  "scope": {
    "time_window": "recent",
    "sources": ["x"],
    "language": ["en", "vi"]
  },
  "output_requirements": {
    "separate_verified_facts": true,
    "separate_weak_signals": true,
    "include_unknowns": true,
    "include_claim_boundaries_for_echo": true
  }
}
```

## Response Example

```json
{
  "schema_version": "hermes.surf.response.v1",
  "delegation_id": "del_surf_001",
  "status": "completed",
  "mode": "surf.x",
  "findings": {
    "verified_facts": [],
    "weak_signals": [],
    "assumptions": [],
    "unknowns": []
  },
  "claim_boundaries": {
    "safe_to_use": [],
    "use_with_caution": [],
    "do_not_use": []
  },
  "recommended_next_action": "CMO should use these signals to create an Echo content brief."
}
```

## Request Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.surf.request.v1`. |
| `delegation_id` | string | yes | Parent delegation id. |
| `mode` | string | yes | One allowed Surf mode. |
| `task` | object | yes | Research task and objective. |
| `scope` | object | yes | Time window, sources, language. |
| `output_requirements` | object | yes | Evidence separation requirements. |

## Response Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.surf.response.v1`. |
| `delegation_id` | string | yes | Mirrors request. |
| `status` | string | yes | Completed, partial, failed, or cancelled. |
| `mode` | string | yes | Mirrors request. |
| `findings` | object | yes | Facts, weak signals, assumptions, unknowns. |
| `claim_boundaries` | object | yes | Safe, caution, and disallowed claims. |
| `recommended_next_action` | string | no | Surf suggestion to CMO. |

## Mode Guidance

| Mode | Use when |
|---|---|
| `surf.default` | General research, public sources, docs, source packs. |
| `surf.x` | X/social discussion signal scan. |
| `surf.trend` | Trend scan across approved sources. |
| `surf.pulse` | Composite pulse analysis across available signals. |

## Rules

- Surf does not decide final strategy.
- Surf does not write final copy.
- Surf does not mutate memory or Vault.
- Surf separates verified facts, weak signals, assumptions, and unknowns.
- Surf returns claim boundaries so CMO can keep Echo inside safe claims.
- X/social signal alone should be treated as weak signal unless supported by stronger evidence.

