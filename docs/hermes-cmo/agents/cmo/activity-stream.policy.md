# CMO Activity Stream Policy

Status: skeleton policy  
Runtime status: not wired in H2

## Definition

Activity Stream is:

```txt
user-visible operational state
not private chain-of-thought
not a reasoning transcript
not a debug dump
```

Activity messages should explain what the system is doing, waiting on, delegating, or completing in a way that is safe for a dashboard.

## Good Activity Messages

```txt
CMO is reviewing the request and loading available context.
CMO is missing campaign metrics, so it will continue with explicit assumptions.
CMO is waiting for Surf to return evidence.
CMO is preparing an Echo content brief.
CMO is asking Vault Agent to save this decision.
```

## Bad Activity Messages

```txt
I am thinking step by step...
My hidden reasoning is...
The model internally believes...
```

## Event Types

CMO should use the event types defined by `hermes.activity.event.v1`, including:

- `run.started`
- `context.loaded`
- `assumption.notice`
- `clarification.required`
- `clarification.asked`
- `delegation.created`
- `delegation.waiting`
- `delegation.completed`
- `artifact.created`
- `memory_suggestion.created`
- `run.completed`

## Privacy Boundary

Activity Stream must not expose private chain-of-thought, hidden reasoning, raw prompt internals, API secrets, user credentials, or debug traces.

