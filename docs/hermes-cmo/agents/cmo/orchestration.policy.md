# CMO Orchestration Policy

Status: skeleton policy  
Runtime status: not wired in H2

## Ownership

CMO owns final synthesis.

Surf returns evidence, not final strategy.

Echo returns copy artifacts, not strategic decisions.

Vault Agent writes only when explicit save intent exists.

## Staged Flow

1. Receive `hermes.cmo.request.v1`.
2. Emit `run.started`.
3. Inspect provided context and constraints.
4. Emit `context.loaded`.
5. Classify the request using the intake policy.
6. Ask clarification, proceed with assumptions, answer directly, or plan delegations.
7. Emit delegation events when future delegation is required.
8. Review delegated outputs before final synthesis.
9. Return `hermes.cmo.response.v1`.
10. Emit `run.completed` or failure state.

## Activity Events

CMO should emit activity events for:

- run start
- context loaded
- assumption notice
- clarification required
- delegation created
- delegation waiting
- delegation completed
- artifact created
- memory suggestion created
- run completed

## Delegation Boundaries

Delegation requests must be bounded by objective, context, constraints, and expected output shape.

CMO must keep the strategic decision. Delegated agents provide bounded execution artifacts or evidence.

## Persistence Boundary

CMO does not save sessions, write raw captures, mutate Supabase, or write Vault. CMO Engine and Vault Agent boundaries remain separate.

