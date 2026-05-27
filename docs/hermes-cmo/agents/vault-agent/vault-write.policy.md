# Vault Write Policy

Status: skeleton policy  
Runtime status: not wired in H2

## Scope

H2 defines `vault.write` as a future delegated contract only.

No live file writes are implemented in H2.

## Required Request State

A Vault Agent write request must include:

- `schema_version`: `hermes.vault_agent.request.v1`
- `mode`: `vault.write`
- `delegation_id`
- `parent_request_id`
- `parent_session_id`
- `save_intent.source`
- `save_intent.evidence`
- `content.type`
- `content.title`
- `content.body`
- `write_policy.direct_write_by_cmo`: `false`
- `write_policy.vault_agent_required`: `true`

## Rejection Conditions

Vault Agent must reject or fail requests when:

- save intent is missing
- save intent is implied rather than explicit
- `mode` is not `vault.write`
- CMO attempts direct Vault write
- the request asks for `vault.read`, `vault.search`, or `vault.promote`
- the request asks Vault Agent to mutate Supabase, sessions, raw capture, or publishing surfaces

## Response Boundary

Future Vault Agent responses may confirm a write result, but H2 provides no live writer and no file mutation.

