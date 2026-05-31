# CMO Response Contract

Schema version: `hermes.cmo.response.v1`  
Status: draft contract  
Runtime status: spec only, not runnable yet

## Purpose

The CMO response is the Hermes CMO to CMO Engine boundary. It carries the final or partial answer, clarification request, structured strategy output, delegations, artifacts, memory suggestions, and activity summary.

## Status Values

```txt
completed
partial
needs_user_input
delegated
failed
cancelled
```

## Answer Basis Modes

```txt
fully_grounded
assumption_based
needs_user_input
native_conversation
source_answer
source_translate
source_transform
structured_review
external_research
save_to_vault
clarify
```

CMO must use `assumption_based` whenever it continues despite missing non-blocking inputs. CMO must use `needs_user_input` when missing inputs block a reliable answer.

## Required Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.cmo.response.v1`. |
| `request_id` | string | yes | Mirrors request. |
| `session_id` | string | yes | Mirrors request. |
| `turn_id` | string | yes | Mirrors request. |
| `status` | string | yes | One status value. |
| `answer_basis` | object | yes | Grounding and assumption state. |
| `clarifying_question` | object | yes | Required question state. |
| `answer` | object or null | yes | Null when blocked on user input. |
| `structured_output` | object or null | yes | Null when no answer exists yet. |
| `delegations` | array | yes | Delegation requests/results or empty. |
| `artifacts` | array | yes | Produced artifacts or empty. |
| `memory_suggestions` | array | yes | Suggestions only, never direct mutation. |
| `activity_summary` | object | yes | Event count and final visible state. |

## Canonical Shape

```json
{
  "schema_version": "hermes.cmo.response.v1",
  "request_id": "req_20260528_001",
  "session_id": "session_abc",
  "turn_id": "turn_abc",
  "status": "completed",
  "answer_basis": {
    "mode": "assumption_based",
    "missing_inputs": ["latest campaign metrics"],
    "assumptions_used": [
      {
        "assumption": "The current goal is demo readiness, not full production readiness.",
        "reason": "The request context mentions demo scope.",
        "impact": "Recommendations prioritize simple, visible user feedback loops over durable workflow infrastructure."
      }
    ],
    "user_can_override": true,
    "suggested_user_inputs": [
      "Confirm whether the goal is demo readiness or production readiness",
      "Provide latest campaign metrics"
    ]
  },
  "clarifying_question": {
    "required": false,
    "question": null,
    "reason": null,
    "missing_inputs": []
  },
  "answer": {
    "format": "markdown",
    "title": "Review kế hoạch Holdstation Mini App",
    "summary": "Plan hiện tại ổn về hướng chiến lược, nhưng cần làm rõ activation loop và measurement layer.",
    "decision": "Proceed with revisions",
    "body": "..."
  },
  "structured_output": {
    "diagnosis": [],
    "recommendations": [],
    "risks": [],
    "next_steps": []
  },
  "delegations": [],
  "artifacts": [],
  "memory_suggestions": [],
  "activity_summary": {
    "events_count": 8,
    "final_state": "completed"
  }
}
```

## Needs User Input Shape

```json
{
  "schema_version": "hermes.cmo.response.v1",
  "request_id": "req_20260528_002",
  "session_id": "session_abc",
  "turn_id": "turn_def",
  "status": "needs_user_input",
  "answer_basis": {
    "mode": "needs_user_input",
    "missing_inputs": ["review_lens"],
    "assumptions_used": [],
    "user_can_override": true,
    "suggested_user_inputs": [
      "Tell CMO whether to review strategy, execution risk, demo readiness, or content quality"
    ]
  },
  "clarifying_question": {
    "required": true,
    "question": "Bạn muốn mình review plan này theo góc strategy, execution risk, demo readiness, hay content quality?",
    "reason": "The request is broad and a review lens is required for a reliable answer.",
    "missing_inputs": ["review_lens"]
  },
  "answer": null,
  "structured_output": null,
  "delegations": [],
  "artifacts": [],
  "memory_suggestions": [],
  "activity_summary": {
    "events_count": 3,
    "final_state": "waiting_for_user"
  }
}
```

## Memory Suggestions

`memory_suggestions` are advisory only. They do not mutate memory and do not write Vault.

Suggested shape:

```json
{
  "suggestion_id": "mem_sug_001",
  "type": "architecture_decision",
  "title": "CMO uses Activity Stream for H1 demo observability",
  "reason": "This decision may be useful in later implementation phases.",
  "confidence": "medium",
  "requires_user_save_intent": true
}
```

## Invariants

- `answer` must be null when `status` is `needs_user_input`.
- `clarifying_question.required` must be true when `answer_basis.mode` is `needs_user_input`.
- `answer_basis.assumptions_used` must not be empty when `answer_basis.mode` is `assumption_based`.
- Delegations must respect the request constraints.
- Any Vault write must be represented as Vault Agent delegation, never direct CMO write.
- `classification` and `structured_output.classification` must be one of the known safe classifications. Unknown classifications are rejected. `clarify` is allowed as a classification for `needs_user_input` responses.
- `save_to_vault` is an intent/classification only; it must not perform a Vault write from the CMO response.
- Direct mutation flags such as `direct_vault_write`, `direct_memory_mutation`, `direct_supabase_write`, `gbrain_mutation`, `knowledge_promotion_performed`, `auto_promote`, `direct_session_write`, `direct_raw_capture_write`, and `openclaw_call` are rejected.
