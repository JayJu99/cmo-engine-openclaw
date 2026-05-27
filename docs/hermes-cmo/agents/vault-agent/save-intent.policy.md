# Save Intent Policy

Status: skeleton policy  
Runtime status: not wired in H2

## Definition

Save intent is explicit user or UI confirmation that specific content should be saved to Vault.

CMO must not infer save intent from usefulness, importance, quality, or memory-worthiness.

## Valid Save Intent

```txt
User says "save this"
User says "lưu lại cái này"
User says "ghi vào Vault"
User clicks explicit save action
User confirms save prompt
```

## Not Valid Save Intent

```txt
CMO thinks this is useful
Surf found good evidence
Echo wrote good copy
A decision appears memory-worthy but user did not ask to save
```

## Memory Suggestion Boundary

Non-save memory-worthy content should produce:

```txt
memory_suggestion
```

not Vault Agent delegation.

## CMO Rule

CMO may delegate `vault.write` to Vault Agent only when explicit save intent exists.

## Vault Agent Rule

Vault Agent must reject or fail write requests without explicit save intent.

