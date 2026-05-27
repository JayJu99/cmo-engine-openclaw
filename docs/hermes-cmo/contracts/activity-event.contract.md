# Activity Event Contract

Schema version: `hermes.activity.event.v1`  
Status: draft contract  
Runtime status: spec only, not runnable yet

## Purpose

Activity events provide user-visible operational state for CMO runs. They are for dashboard observability, not chain-of-thought. Events should explain what the system is doing, waiting on, delegating, or completing.

## Required Envelope

```json
{
  "schema_version": "hermes.activity.event.v1",
  "event_id": "evt_001",
  "request_id": "req_20260528_001",
  "session_id": "session_abc",
  "turn_id": "turn_abc",
  "seq": 1,
  "created_at": "2026-05-28T10:00:01+07:00",
  "source": {
    "agent": "cmo",
    "mode": "cmo.default"
  },
  "type": "run.started",
  "status": "running",
  "user_visible": true,
  "message": "CMO is reviewing the request and loading available context.",
  "data": {}
}
```

## Required Fields

| Field | Type | Required | Notes |
|---|---:|---:|---|
| `schema_version` | string | yes | Must be `hermes.activity.event.v1`. |
| `event_id` | string | yes | Unique event id. |
| `request_id` | string | yes | Parent CMO request id. |
| `session_id` | string | yes | Session id. |
| `turn_id` | string | yes | Turn id. |
| `seq` | number | yes | Monotonic sequence per request. |
| `created_at` | string | yes | ISO-8601 timestamp with offset. |
| `source` | object | yes | Agent and mode that emitted the event. |
| `type` | string | yes | Event type. |
| `status` | string | yes | User-visible event state. |
| `user_visible` | boolean | yes | H1 events should normally be true. |
| `message` | string | yes | Short operational message. |
| `data` | object | yes | Typed event details or empty object. |

## Event Types

```txt
run.started
run.heartbeat
stage.started
stage.completed
context.loaded
assumption.notice
clarification.required
clarification.asked
plan.created
delegation.created
delegation.started
delegation.waiting
delegation.completed
artifact.created
memory_suggestion.created
vault_agent.delegation.created
vault_agent.delegation.started
vault_agent.delegation.completed
vault_agent.delegation.failed
run.completed
run.failed
```

## Status Values

Recommended event status values:

```txt
queued
running
waiting
completed
failed
cancelled
```

## Heartbeat Example

```json
{
  "schema_version": "hermes.activity.event.v1",
  "event_id": "evt_heartbeat_001",
  "request_id": "req_20260528_001",
  "session_id": "session_abc",
  "turn_id": "turn_abc",
  "seq": 5,
  "created_at": "2026-05-28T10:00:12+07:00",
  "source": {
    "agent": "cmo",
    "mode": "cmo.default"
  },
  "type": "run.heartbeat",
  "status": "running",
  "user_visible": true,
  "message": "CMO is waiting for Surf to return evidence.",
  "data": {
    "current_stage": "delegation",
    "waiting_on": "surf",
    "delegation_id": "del_surf_001"
  }
}
```

## Assumption Notice Example

```json
{
  "schema_version": "hermes.activity.event.v1",
  "event_id": "evt_assumption_001",
  "request_id": "req_20260528_001",
  "session_id": "session_abc",
  "turn_id": "turn_abc",
  "seq": 3,
  "created_at": "2026-05-28T10:00:04+07:00",
  "source": {
    "agent": "cmo",
    "mode": "cmo.default"
  },
  "type": "assumption.notice",
  "status": "running",
  "user_visible": true,
  "message": "CMO is missing campaign metrics, so it will continue using stated assumptions unless the user provides more data.",
  "data": {
    "missing_inputs": ["campaign metrics"],
    "assumptions_used": [
      "The current goal is demo readiness, not full production readiness."
    ]
  }
}
```

## Clarification Example

```json
{
  "schema_version": "hermes.activity.event.v1",
  "event_id": "evt_clarification_001",
  "request_id": "req_20260528_002",
  "session_id": "session_abc",
  "turn_id": "turn_def",
  "seq": 2,
  "created_at": "2026-05-28T10:02:01+07:00",
  "source": {
    "agent": "cmo",
    "mode": "cmo.default"
  },
  "type": "clarification.required",
  "status": "waiting",
  "user_visible": true,
  "message": "CMO needs one clarification before making a reliable recommendation.",
  "data": {
    "missing_inputs": ["review_lens"]
  }
}
```

## Invariants

- Activity events must not expose private chain-of-thought.
- Activity events must be safe to show in the user dashboard.
- Heartbeat events should be emitted during waits on delegated agents.
- Assumption-based answers require an `assumption.notice` event.
- Blocked clarification requires `clarification.required` and `clarification.asked` events.
- Vault Agent writes should use `vault_agent.delegation.*` event types.

