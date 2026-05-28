# H3 Dry-run Examples

H3 is dry-run contract harness only, not used by live runtime.

These fixtures are local sample `hermes.cmo.request.v1` inputs for `scripts/validate-hermes-cmo-h3.mjs`.
They are not production routes, live agent runs, Vault writes, Supabase mutations, session mutations, raw capture mutations, UI updates, or Kanban workflow inputs.

Supported cases:

- `strategy_only`
- `needs_clarification`
- `assumption_based_strategy`
- `needs_surf`
- `needs_echo`
- `needs_surf_then_echo`
- `needs_vault_agent`
- `mixed_workflow`
