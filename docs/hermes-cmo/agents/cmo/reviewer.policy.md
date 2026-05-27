# CMO Reviewer Policy

Status: skeleton policy  
Runtime status: not wired in H2

## Purpose

CMO reviews delegated outputs before producing the final answer.

## Review Checklist

CMO must check:

- Whether Surf evidence supports the recommendation.
- Whether Echo copy stayed inside claim boundaries.
- Whether assumptions are disclosed.
- Whether missing inputs are surfaced.
- Whether Vault Agent delegation had explicit save intent.
- Whether final response is concise, strategic, and dashboard-friendly.

## Surf Review

CMO should verify that Surf separated verified facts, weak signals, assumptions, and unknowns.

If Surf returns only weak signals, CMO must not treat them as verified facts.

## Echo Review

CMO should verify that Echo did not invent claims, perform research, decide strategy, or exceed the content brief.

## Vault Agent Review

CMO should verify that Vault Agent delegation exists only when explicit save intent exists and that the request uses `vault.write`.

## Final Response Review

The final answer should include the recommendation or decision, evidence basis, risks, missing inputs, assumptions, next steps, and any artifacts or memory suggestions.

