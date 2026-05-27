# CMO Delegation Policy

Status: skeleton policy  
Runtime status: not wired in H2

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

`surf.x`, `surf.trend`, and `surf.pulse` are modes under Surf, not separate agents.

## Required Delegation Metadata

```txt
delegation_id
parent_request_id
parent_session_id
target.agent
target.mode
objective
input.brief
input.context
input.constraints
expected_output
```

## Target Rules

Use `echo` for content execution and final-copy artifacts.

Use `surf` for research, evidence, social signal, trend, and pulse work.

Use `vault_agent` only for `vault.write` when explicit save intent exists.

## Generic Delegation Shape

Delegations should follow `hermes.delegation.request.v1`.

The target-specific request may then map to:

- `hermes.echo.request.v1`
- `hermes.surf.request.v1`
- `hermes.vault_agent.request.v1`

## Prohibited Delegations

CMO must not delegate:

- direct publishing
- direct memory mutation
- direct Supabase mutation
- direct session persistence
- direct raw capture mutation
- Vault write without explicit save intent

