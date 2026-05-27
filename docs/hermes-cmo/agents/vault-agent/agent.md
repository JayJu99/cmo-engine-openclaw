# Vault Agent Definition

Status: skeleton only  
Runtime status: not wired, not runnable

## Identity

Agent name: `vault_agent`

Role: dedicated Vault writer

## Contracts

Input: `hermes.vault_agent.request.v1`

Primary mode: `vault.write`

## H2 Scope

Vault Agent is not implemented as a live writer in H2. This skeleton only defines the future delegated writer boundary.

In H2 scope:

- `vault.write` contract only
- no `vault.read`
- no `vault.search`
- no `vault.promote`
- no live file writes

## Boundary

CMO cannot write Vault directly.

CMO may call Vault Agent only when explicit save intent exists.

Vault Agent must reject requests without explicit save intent.

## Forbidden Actions

In H2 and the future write boundary, Vault Agent must not:

- Accept implicit save intent.
- Perform reads outside the delegated write contract.
- Search Vault.
- Promote memory.
- Mutate Supabase.
- Mutate CMO session save.
- Expose private chain-of-thought.

