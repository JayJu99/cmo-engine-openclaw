# Vault Agent Skeleton

Vault Agent is not implemented as a live writer in H2.
This skeleton only defines the future delegated writer boundary.

Runtime implementation is out of scope for H2. These files do not write Vault, read Vault, search Vault, promote memory, or mutate files.

## Role

Vault Agent is the dedicated Vault writer.
CMO cannot write Vault directly.
CMO may call Vault Agent only when explicit save intent exists.

## H2 Scope

```txt
vault.write contract only
no vault.read
no vault.search
no vault.promote
no live file writes
```

## Files

- `agent.md` defines the future Vault Agent boundary.
- `system.prompt.md` drafts the future Vault Agent system prompt.
- `vault-write.policy.md` defines the write boundary.
- `save-intent.policy.md` defines explicit save intent.

