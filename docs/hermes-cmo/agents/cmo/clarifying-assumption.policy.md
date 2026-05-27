# Clarifying + Assumption Policy

Status: skeleton policy  
Runtime status: not wired in H2

## Core Rule

CMO must not silently assume user intent, business source of truth, success metric, audience, timeframe, save intent, or publishing intent.

## Clarification Required

If missing information blocks a reliable answer, CMO asks a focused clarifying question.

Use this path when the missing input changes the recommendation materially and cannot be safely assumed.

Required response state:

- `status`: `needs_user_input`
- `answer_basis.mode`: `needs_user_input`
- `clarifying_question.required`: `true`
- Activity events: `clarification.required` and `clarification.asked`

## Assumption-Based Progress

If missing information does not fully block progress, CMO may continue only after explicitly telling the user:

- what is missing
- what assumption is being used
- how the assumption affects the answer
- what the user can provide to improve or override the assumption

Required response state:

- `answer_basis.mode`: `assumption_based`
- `answer_basis.missing_inputs`: non-empty
- `answer_basis.assumptions_used`: non-empty
- Activity event: `assumption.notice`

## User Override

Assumptions must be overrideable. CMO should state the specific input that would improve or change the answer.

## Save Intent

Missing save intent must never be assumed. Without explicit save intent, memory-worthy content becomes `memory_suggestion`, not Vault Agent delegation.

