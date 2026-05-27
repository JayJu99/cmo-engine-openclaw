# Echo Delegation Contract

Schema versions:

```txt
hermes.echo.request.v1
hermes.echo.response.v1
```

Status: draft contract  
Runtime status: spec only, not runnable yet

## Purpose

Echo is the content and final-copy executor. CMO gives Echo a bounded content brief and claim boundaries. Echo returns artifacts and notes about claims used or avoided.

Echo does not decide strategy, perform research, or invent claims.

## Request Example

```json
{
  "schema_version": "hermes.echo.request.v1",
  "delegation_id": "del_echo_001",
  "task": {
    "type": "final_copy",
    "objective": "Write 3 short X posts based on the approved CMO brief."
  },
  "content_brief": {
    "audience": "crypto users interested in Mini App activation",
    "angle": "activation as hidden growth lever",
    "tone": "sharp, human, non-corporate",
    "language": "en",
    "format": "x_posts"
  },
  "claim_boundaries": {
    "safe_to_use": [],
    "do_not_use": [],
    "required_disclaimers": []
  },
  "constraints": {
    "no_new_claims": true,
    "no_research": true,
    "max_variants": 3
  }
}
```

## Response Example

```json
{
  "schema_version": "hermes.echo.response.v1",
  "delegation_id": "del_echo_001",
  "status": "completed",
  "artifacts": [
    {
      "artifact_id": "echo_x_posts_001",
      "type": "x_posts",
      "content_format": "markdown",
      "content": "..."
    }
  ],
  "notes": {
    "claims_used": [],
    "claims_avoided": []
  }
}
```

## Request Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.echo.request.v1`. |
| `delegation_id` | string | yes | Parent delegation id. |
| `task` | object | yes | Content task type and objective. |
| `content_brief` | object | yes | Audience, angle, tone, language, format. |
| `claim_boundaries` | object | yes | Allowed and disallowed claims. |
| `constraints` | object | yes | Execution limits. |

## Response Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.echo.response.v1`. |
| `delegation_id` | string | yes | Mirrors request. |
| `status` | string | yes | Completed, partial, failed, or cancelled. |
| `artifacts` | array | yes | Content artifacts. |
| `notes` | object | yes | Claims used and avoided. |

## Rules

```txt
Echo does not decide strategy.
Echo does not perform research.
Echo does not invent claims.
Echo writes inside CMO/Surf claim boundaries.
```

Additional rules:

- `constraints.no_new_claims` should be true for H1.
- `constraints.no_research` should be true for H1.
- Echo must return artifacts rather than modifying external publishing surfaces.
- Echo must flag if the requested copy cannot be produced without unsupported claims.

