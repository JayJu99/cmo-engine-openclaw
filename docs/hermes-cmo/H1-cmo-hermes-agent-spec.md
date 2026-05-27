# Phase H1 — Hermes CMO Agent Contract & Clean Skill Kernel

Status: draft spec  
Scope: documentation and contracts only  
Runtime status: spec only, not runnable yet  
Last updated: 2026-05-28

## 1. Purpose

Phase H1 defines the Hermes-native CMO Agent contract and the Clean CMO Skill Kernel. It captures the strategic CMO thinking layer that should survive the migration away from the old OpenClaw-based CMO direction while removing runtime assumptions that do not belong inside the skill.

CMO Hermes is the strategic brain, orchestrator, and reviewer. It decides what the user needs, whether enough context exists, whether assumptions are acceptable, and whether Echo, Surf, or Vault Agent should be delegated a bounded task.

H1 is a spec/design phase only. It does not create runnable Hermes CMO Agent code, Vault Agent code, runtime routing, or CMO Engine integration.

Core boundary:

```txt
CMO Engine resolves context.
Hermes CMO reasons and orchestrates.
CMO Engine still saves session/raw/index as current system behavior.
```

## 2. Non-goals

H1 does not:

- Migrate the full OpenClaw CMO pack.
- Implement a runnable Hermes CMO Agent.
- Implement Vault Agent write behavior.
- Wire CMO Engine to Hermes CMO.
- Modify live CMO runtime behavior.
- Modify Vault writing logic.
- Modify Supabase index logic.
- Modify session save logic.
- Modify OpenClaw runtime code.
- Add runtime delegation logic.
- Add Kanban implementation.
- Reintroduce Radar or old agents.

## 3. Final H1 Decisions

- Migrate only a Clean CMO Skill Kernel, not the full OpenClaw CMO pack.
- Remove OpenClaw runtime assumptions from the CMO skill.
- Remove Gateway-specific assumptions from the CMO skill.
- Remove Radar and old agents from the CMO skill.
- Treat Trend, Pulse, and Surf X as Surf modes, not separate agents.
- Keep Echo as the content/final-copy executor.
- Keep Surf as the research, evidence, social signal, trend, and pulse executor.
- Rename "Vault Scribe Agent" to "Vault Agent".
- Allow CMO to call Vault Agent only when explicit save intent exists.
- Prohibit direct Vault writes by CMO.
- Prohibit direct memory mutation by CMO.
- Allow CMO to emit `memory_suggestion` records.
- Keep CMO Engine ownership of session save, raw capture, Supabase index, UI state, and current session persistence.
- Use Activity Stream / Heartbeat for H1 demo observability.
- Keep Kanban out of H1 and demo scope.

Agent map:

```txt
CMO Hermes
├─ Echo
├─ Surf
│  ├─ surf.default
│  ├─ surf.x
│  ├─ surf.trend
│  └─ surf.pulse
└─ Vault Agent
   └─ vault.write only when save intent exists
```

Definitions:

| Layer | Definition |
|---|---|
| CMO | Strategic brain, orchestrator, reviewer, recommendation owner. |
| Echo | Content and final copy executor. |
| Surf | Research, evidence, public source, social signal, trend, and pulse executor. |
| Vault Agent | Delegated Vault writer only when explicit save intent exists. |

## 4. Clean CMO Skill Kernel

The Clean CMO Skill Kernel is the reusable strategic layer extracted from the old CMO direction. It is not a runtime adapter and does not own persistence.

Keep:

1. Strategic reasoning
   - Understand business context.
   - Parse goals, constraints, risks, assumptions, and missing inputs.
   - Think from a C-level / strategic operator perspective.
   - Give recommendations and decisions.
   - Know when to ask the user for clarification.

2. Orchestration logic
   - Strategy-only request: answer directly.
   - Research/evidence request: delegate to Surf.
   - Content/final copy request: delegate to Echo.
   - Research then content request: delegate to Surf first, synthesize, then delegate to Echo.
   - Save intent: delegate to Vault Agent.

3. Evidence discipline
   - Separate verified facts, assumptions, weak signals, and unknowns.
   - Prevent unsupported claims.
   - Require Echo to stay inside CMO/Surf claim boundaries.
   - Use Surf evidence as input, while CMO keeps final decision ownership.

4. Output style
   - Concise, structured, strategic.
   - Clear recommendation or decision.
   - Clear risks and next steps.
   - Easy to display in a dashboard.

5. Memory suggestions
   - CMO may emit memory suggestions.
   - CMO must not mutate memory directly.
   - Weak memory-worthy content becomes `memory_suggestion`, not a Vault write.
   - Explicit save intent can trigger Vault Agent delegation.

Remove:

- OpenClaw runtime assumptions.
- OpenClaw-specific tools.
- Gateway-specific assumptions.
- Direct Vault write.
- Direct memory mutation.
- Radar and old agents.
- Trend, Pulse, and Surf X as separate agents.
- Full Kanban workflow for demo.

## 5. Clarifying + Assumption Protocol

CMO must support two paths when information is missing.

Case 1: missing information blocks a reliable answer.

CMO must ask a focused clarification question instead of guessing.

```txt
Mình cần clarify thêm 1 điểm trước khi review chính xác:
Bạn muốn mình review plan này theo góc strategy, demo readiness, hay execution risk?
```

Case 2: missing information does not fully block progress.

CMO may continue, but must explicitly tell the user:

- What data or context is missing.
- What assumptions CMO is making.
- How those assumptions affect the answer.
- What the user can provide to improve or correct the answer.

Rule:

```txt
CMO không được âm thầm giả định.
Nếu dùng giả định, user phải thấy rõ CMO đang thiếu gì, đang giả định gì,
và có thể phản hồi để sửa giả định hoặc cung cấp thêm dữ liệu.
```

Recommended assumption-based structure:

```txt
Mình đang thiếu dữ kiện:
- ...

Vì vậy ở phần này mình sẽ giả định rằng:
- ...

Nếu giả định này đúng, recommendation của mình là:
- ...

Nếu giả định chưa đúng, bạn có thể cung cấp thêm:
- ...
```

Operational rules:

- `answer_basis.mode` must be `needs_user_input` when missing inputs block a reliable answer.
- `answer_basis.mode` must be `assumption_based` when CMO proceeds with explicit assumptions.
- CMO must emit an `assumption.notice` activity event when assumptions affect the answer.
- CMO must emit `clarification.required` and `clarification.asked` activity events when the answer is blocked.
- CMO must not silently assume user intent, business source of truth, success metric, audience, timeframe, save intent, or publishing intent.

## 6. Hermes CMO Agent File Structure

H1 creates documentation and example contract files only:

```txt
docs/hermes-cmo/
├─ H1-cmo-hermes-agent-spec.md
├─ contracts/
│  ├─ cmo-request.contract.md
│  ├─ cmo-response.contract.md
│  ├─ activity-event.contract.md
│  ├─ delegation.contract.md
│  ├─ echo-delegation.contract.md
│  ├─ surf-delegation.contract.md
│  └─ vault-agent-delegation.contract.md
└─ examples/
   ├─ request.strategy-only.json
   ├─ request.surf-needed.json
   ├─ request.echo-needed.json
   ├─ request.surf-then-echo.json
   ├─ request.vault-agent-save.json
   ├─ response.completed.json
   ├─ response.needs-user-input.json
   ├─ response.assumption-based.json
   └─ activity-stream.jsonl
```

Optional future non-runtime skeletons such as `hermes/agents/cmo/README.md` or `hermes/agents/vault-agent/README.md` may be added in a later documentation phase, but they must state:

```txt
Spec only. Not runnable yet.
Runtime implementation is out of scope for H1.
```

## 7. CMO Request Contract

Schema version: `hermes.cmo.request.v1`

Contract file: [cmo-request.contract.md](contracts/cmo-request.contract.md)

The CMO request is built by CMO Engine after context resolution. It gives Hermes CMO the user message, selected context, constraints, allowed agent boundaries, and UI observability requirements.

Canonical example:

```json
{
  "schema_version": "hermes.cmo.request.v1",
  "request_id": "req_20260528_001",
  "session_id": "session_abc",
  "turn_id": "turn_abc",
  "created_at": "2026-05-28T10:00:00+07:00",
  "workspace": {
    "workspace_id": "world-app-holdstation-mini-app",
    "app_id": "holdstation-mini-app",
    "app_name": "Holdstation Mini App"
  },
  "user": {
    "user_id": "server_derived_user_id",
    "display_name": "Jay"
  },
  "intent": {
    "mode": "cmo.default",
    "user_message": "Review plan này giúp mình",
    "explicit_command": null
  },
  "context_pack": {
    "current_priority": [],
    "selected_context": [],
    "recent_session_summary": null,
    "indexed_context_supplement": [],
    "artifacts_in": []
  },
  "constraints": {
    "no_direct_vault_write": true,
    "no_direct_memory_mutation": true,
    "vault_agent_delegation_allowed": true,
    "vault_agent_requires_save_intent": true,
    "kanban_enabled": false,
    "demo_mode": true,
    "allowed_agents": ["echo", "surf", "vault_agent"],
    "allowed_surf_modes": [
      "surf.default",
      "surf.x",
      "surf.trend",
      "surf.pulse"
    ]
  },
  "ui": {
    "activity_stream_required": true,
    "heartbeat_required": true
  }
}
```

Important boundary:

```txt
CMO Engine resolves context.
Hermes CMO reasons and orchestrates.
CMO Engine still saves session/raw/index as current system behavior.
```

## 8. CMO Response Contract

Schema version: `hermes.cmo.response.v1`

Contract file: [cmo-response.contract.md](contracts/cmo-response.contract.md)

Status values:

```txt
completed
partial
needs_user_input
delegated
failed
cancelled
```

`answer_basis.mode` values:

```txt
fully_grounded
assumption_based
needs_user_input
```

Canonical assumption-based response:

```json
{
  "schema_version": "hermes.cmo.response.v1",
  "request_id": "req_20260528_001",
  "session_id": "session_abc",
  "turn_id": "turn_abc",
  "status": "completed",
  "answer_basis": {
    "mode": "assumption_based",
    "missing_inputs": ["latest campaign metrics"],
    "assumptions_used": [
      {
        "assumption": "The current goal is demo readiness, not full production readiness.",
        "reason": "The request context mentions demo scope.",
        "impact": "Recommendations prioritize simple, visible user feedback loops over durable workflow infrastructure."
      }
    ],
    "user_can_override": true,
    "suggested_user_inputs": [
      "Confirm whether the goal is demo readiness or production readiness",
      "Provide latest campaign metrics"
    ]
  },
  "clarifying_question": {
    "required": false,
    "question": null,
    "reason": null,
    "missing_inputs": []
  },
  "answer": {
    "format": "markdown",
    "title": "Review kế hoạch Holdstation Mini App",
    "summary": "Plan hiện tại ổn về hướng chiến lược, nhưng cần làm rõ activation loop và measurement layer.",
    "decision": "Proceed with revisions",
    "body": "..."
  },
  "structured_output": {
    "diagnosis": [],
    "recommendations": [],
    "risks": [],
    "next_steps": []
  },
  "delegations": [],
  "artifacts": [],
  "memory_suggestions": [],
  "activity_summary": {
    "events_count": 8,
    "final_state": "completed"
  }
}
```

Canonical needs-user-input response:

```json
{
  "schema_version": "hermes.cmo.response.v1",
  "request_id": "req_20260528_002",
  "session_id": "session_abc",
  "turn_id": "turn_def",
  "status": "needs_user_input",
  "answer_basis": {
    "mode": "needs_user_input",
    "missing_inputs": ["review_lens"],
    "assumptions_used": [],
    "user_can_override": true,
    "suggested_user_inputs": [
      "Tell CMO whether to review strategy, execution risk, demo readiness, or content quality"
    ]
  },
  "clarifying_question": {
    "required": true,
    "question": "Bạn muốn mình review plan này theo góc strategy, execution risk, demo readiness, hay content quality?",
    "reason": "The request is broad and a review lens is required for a reliable answer.",
    "missing_inputs": ["review_lens"]
  },
  "answer": null,
  "structured_output": null,
  "delegations": [],
  "artifacts": [],
  "memory_suggestions": [],
  "activity_summary": {
    "events_count": 3,
    "final_state": "waiting_for_user"
  }
}
```

## 9. Activity Stream / Heartbeat Contract

Schema version: `hermes.activity.event.v1`

Contract file: [activity-event.contract.md](contracts/activity-event.contract.md)

Activity Stream is user-visible operational state, not chain-of-thought. It tells the dashboard what the agent is doing, waiting on, delegating, or completing.

Required event envelope:

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

Event types:

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

Heartbeat example:

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

Assumption notice example:

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

Clarification example:

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

## 10. Delegation Contract

Schema version: `hermes.delegation.request.v1`

Contract file: [delegation.contract.md](contracts/delegation.contract.md)

Allowed delegation targets:

```txt
echo
surf
vault_agent
```

Allowed Surf modes:

```txt
surf.default
surf.x
surf.trend
surf.pulse
```

Common request:

```json
{
  "schema_version": "hermes.delegation.request.v1",
  "delegation_id": "del_001",
  "parent_request_id": "req_20260528_001",
  "parent_session_id": "session_abc",
  "target": {
    "agent": "surf",
    "mode": "surf.x"
  },
  "objective": "Find current X discussion signals around Holdstation Mini App activation.",
  "input": {
    "brief": "CMO needs evidence before forming a recommendation.",
    "context": [],
    "constraints": []
  },
  "expected_output": {
    "format": "structured_json",
    "required_sections": [
      "verified_facts",
      "weak_signals",
      "assumptions",
      "unknowns",
      "claim_boundaries"
    ]
  }
}
```

Delegation rules:

- CMO owns the final strategic decision.
- Delegated agents return bounded outputs, not final strategy unless explicitly scoped as draft input.
- Delegation requests must include objective, input brief, constraints, and expected output shape.
- CMO must emit delegation activity events for created, started, waiting, completed, and failed states.
- Delegation must respect `allowed_agents` and `allowed_surf_modes` from the CMO request.

## 11. Echo Delegation Contract

Schema versions:

```txt
hermes.echo.request.v1
hermes.echo.response.v1
```

Contract file: [echo-delegation.contract.md](contracts/echo-delegation.contract.md)

Echo request example:

```json
{
  "schema_version": "hermes.echo.request.v1",
  "delegation_id": "del_echo_001",
  "task": {
    "type": "final_copy",
    "objective": "Write 3 short X posts based on the approved CMO brief."
  },
  "content_brief": {
    "audience": "crypto users interested in Mini App activation",
    "angle": "activation as hidden growth lever",
    "tone": "sharp, human, non-corporate",
    "language": "en",
    "format": "x_posts"
  },
  "claim_boundaries": {
    "safe_to_use": [],
    "do_not_use": [],
    "required_disclaimers": []
  },
  "constraints": {
    "no_new_claims": true,
    "no_research": true,
    "max_variants": 3
  }
}
```

Echo response example:

```json
{
  "schema_version": "hermes.echo.response.v1",
  "delegation_id": "del_echo_001",
  "status": "completed",
  "artifacts": [
    {
      "artifact_id": "echo_x_posts_001",
      "type": "x_posts",
      "content_format": "markdown",
      "content": "..."
    }
  ],
  "notes": {
    "claims_used": [],
    "claims_avoided": []
  }
}
```

Important Echo rule:

```txt
Echo does not decide strategy.
Echo does not perform research.
Echo does not invent claims.
Echo writes inside CMO/Surf claim boundaries.
```

## 12. Surf Delegation Contract

Schema versions:

```txt
hermes.surf.request.v1
hermes.surf.response.v1
```

Contract file: [surf-delegation.contract.md](contracts/surf-delegation.contract.md)

Surf request example:

```json
{
  "schema_version": "hermes.surf.request.v1",
  "delegation_id": "del_surf_001",
  "mode": "surf.x",
  "task": {
    "type": "social_signal_scan",
    "objective": "Analyze X discussion around Holdstation Mini App activation.",
    "questions": [
      "What are users reacting to?",
      "What pain points or hooks appear repeatedly?",
      "What claims are safe for Echo to use?"
    ]
  },
  "scope": {
    "time_window": "recent",
    "sources": ["x"],
    "language": ["en", "vi"]
  },
  "output_requirements": {
    "separate_verified_facts": true,
    "separate_weak_signals": true,
    "include_unknowns": true,
    "include_claim_boundaries_for_echo": true
  }
}
```

Surf response example:

```json
{
  "schema_version": "hermes.surf.response.v1",
  "delegation_id": "del_surf_001",
  "status": "completed",
  "mode": "surf.x",
  "findings": {
    "verified_facts": [],
    "weak_signals": [],
    "assumptions": [],
    "unknowns": []
  },
  "claim_boundaries": {
    "safe_to_use": [],
    "use_with_caution": [],
    "do_not_use": []
  },
  "recommended_next_action": "CMO should use these signals to create an Echo content brief."
}
```

Surf rules:

- Surf does not decide strategy.
- Surf does not write final copy.
- Surf must separate verified facts, weak signals, assumptions, and unknowns.
- `surf.x`, `surf.trend`, and `surf.pulse` are modes under Surf, not separate agents.
- Surf may provide claim boundaries for Echo, but CMO decides which claims enter the content brief.

## 13. Vault Agent Delegation Contract

Schema versions:

```txt
hermes.vault_agent.request.v1
hermes.vault_agent.response.v1
```

Contract file: [vault-agent-delegation.contract.md](contracts/vault-agent-delegation.contract.md)

Vault Agent is only in scope for `vault.write` during H1/H2. Future possible modes such as `vault.read`, `vault.search`, or `vault.promote` are out of scope for H1.

Vault Agent request example:

```json
{
  "schema_version": "hermes.vault_agent.request.v1",
  "delegation_id": "del_vault_agent_001",
  "parent_request_id": "req_001",
  "parent_session_id": "session_abc",
  "mode": "vault.write",
  "save_intent": {
    "source": "user_explicit_request",
    "evidence": "User said: lưu lại cái này"
  },
  "content": {
    "type": "architecture_decision",
    "title": "CMO can delegate Vault writes to Vault Agent",
    "body": "CMO does not write Vault directly, but may call Vault Agent when save intent is explicit."
  },
  "write_policy": {
    "direct_write_by_cmo": false,
    "vault_agent_required": true,
    "requires_confirmation": false
  }
}
```

Vault Agent response example:

```json
{
  "schema_version": "hermes.vault_agent.response.v1",
  "delegation_id": "del_vault_agent_001",
  "status": "completed",
  "result": {
    "write_confirmed": true,
    "vault_location": "architecture-decisions/cmo-vault-agent-rule.md",
    "summary": "Saved architecture decision about CMO delegating Vault writes to Vault Agent."
  }
}
```

Important Vault rule:

```txt
CMO cannot write Vault directly.
CMO can delegate to Vault Agent when save intent is explicit.
Weak memory-worthy content should become memory_suggestion only.
```

## 14. Demo Flow

```txt
User sends request
→ CMO Engine builds CMO request
→ Hermes CMO starts run
→ Activity Stream shows run.started
→ CMO loads provided context
→ CMO checks missing data
→ CMO either asks clarification or proceeds with explicit assumptions
→ CMO decides whether to delegate
→ If needed, CMO calls Surf/Echo/Vault Agent
→ Activity Stream shows delegation state and heartbeat
→ CMO synthesizes final answer
→ CMO returns response + artifacts + memory suggestions
→ CMO Engine saves session/raw/index as current system behavior
```

Demo UI requirements:

- Show `run.started` quickly after request creation.
- Show `context.loaded` when CMO has received the resolved context pack.
- Show `assumption.notice` before an assumption-based answer.
- Show `clarification.required` and `clarification.asked` when user input is required.
- Show delegation state for Surf, Echo, and Vault Agent.
- Show `run.heartbeat` while waiting on any delegated agent.
- Show final state as `completed`, `partial`, `waiting_for_user`, `failed`, or `cancelled`.

## 15. Future Kanban Boundary

Kanban is not part of the H1 demo. H1 needs Activity Stream / Heartbeat only.

Future Kanban can consume:

- Activity events.
- Delegations.
- Artifacts.
- Workflow states.
- Human-in-loop checkpoints.

Future Kanban should be a durable production workflow layer, not a hidden dependency of the H1 demo contract.

## 16. Acceptance Criteria

H1 is complete when:

- `docs/hermes-cmo/H1-cmo-hermes-agent-spec.md` exists.
- Spec clearly separates CMO, Echo, Surf, and Vault Agent.
- Spec clearly says Trend/Pulse/Surf X are Surf modes, not agents.
- Spec clearly says CMO cannot directly write Vault.
- Spec clearly says CMO can delegate Vault writes to Vault Agent only with save intent.
- Spec includes Clarifying + Assumption Protocol.
- Spec includes request contract.
- Spec includes response contract.
- Spec includes activity event contract.
- Spec includes heartbeat contract.
- Spec includes Echo delegation contract.
- Spec includes Surf delegation contract.
- Spec includes Vault Agent delegation contract.
- Spec includes examples for strategy-only, Surf-needed, Echo-needed, Surf to CMO to Echo, Vault Agent save, needs user input, and assumption-based answer.
- No runtime behavior changed.
- No Vault writing behavior changed.
- No Supabase/index/session behavior changed.
- No OpenClaw runtime integration added.
- No Kanban implementation added.
- Build/lint still pass if available and applicable.

