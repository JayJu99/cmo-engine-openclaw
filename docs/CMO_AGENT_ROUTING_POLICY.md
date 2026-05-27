# CMO Agent Routing Policy

Status: active  
Scope: CMO Engine / Holdstation Mini App  
Last updated: 2026-05-21

## Overview

CMO Engine uses OpenClaw CMO as the strategic brain and Hermes agents as execution specialists. CMO owns diagnosis, prioritization, and final decisions. Hermes agents provide bounded execution: Echo writes final copy, Surf gathers evidence, and Surf X gathers read-only X/social signal.

Core law: **missing user intent/context means ask Jay; missing evidence means call Surf/Surf X; missing final copy means call Echo; final decision stays with CMO.**

## Current architecture

```text
Jay / CMO UI
  ├─ /echo or @echo at start ───────────────▶ Hermes Echo direct
  ├─ /surf x or @surf x at start ───────────▶ Hermes Surf X direct
  ├─ /surf or @surf at start ───────────────▶ Hermes Surf direct
  ├─ strategic request + internal @Echo ────▶ CMO strategy → Hermes Echo final copy
  ├─ strategic request needing evidence ────▶ Hermes Surf/Surf X evidence → CMO decision
  └─ strategy answerable from context ──────▶ OpenClaw CMO only
```

## Agent role table

| Agent / layer | Owns | Must not own |
|---|---|---|
| CMO | Strategy, diagnosis, decisions, mission design, review, memory ownership, KEEP / CUT / TEST / SCALE / WAIT | Raw research execution, final copy execution, publishing, fake evidence |
| Echo | Final content copy, rewrites, hooks, X/Facebook/Telegram copy, platform adaptation | Strategy, research, publishing, unsupported claims |
| Surf | Public/source research, docs, URLs, notes, PDFs, YouTube, competitor/source packs, evidence gaps, input structuring | Strategy decisions, final copy, publishing |
| Surf X | X/social signal via read-only xAI/Hermes X Search | Verified-fact claims, X mutation, xurl, cookies, last30days backend, publishing |
| Last30Days | Future optional recent-community/trend mode; sandbox only for Reddit/HN/Polymarket safe-mode sources | CMO UI routing today, X backend, production orchestration |
| Lens | Metrics/data resolver/reporting layer | Hermes execution, final strategic decision |
| Radar | Deferred future signal clustering/noise filtering when signal volume warrants it | Current CMO UI routing |

## Routing decision matrix

| User intent / pattern | Route | Notes |
|---|---|---|
| `/echo ...` or `@echo ...` at start | Direct Echo | No CMO strategic decisioning. |
| `/surf x ...` or `@surf x ...` at start | Direct Surf X | X Search read-only; social signal only. |
| `/surf ...` or `@surf ...` at start | Direct Surf | Normal Surf research/input structuring. |
| Internal `@Echo` inside strategic request | CMO → Echo | CMO strategy first; Echo final copy second. |
| Strategic request needing public evidence/docs/source | CMO → Surf → CMO | Surf evidence only; CMO final decision. |
| Strategic request needing X/social signal | CMO → Surf X → CMO | X signal only; CMO final decision. |
| Missing decision-critical user context | Clarification Gate | Ask 1–3 questions; no Surf/Echo. |
| Content-only request | Echo route | Echo owns final copy; CMO supplies angle/constraints when needed. |
| Source/research-only request | Surf route | No CMO strategic diagnosis required. |
| X/social-only request | Surf X route | No CMO strategy unless asked. |
| Strategy answerable from context | CMO only | No agent call just for show. |

## Clarification vs evidence rule

- Missing goal, audience, timeframe, product scope, expected output, success metric, approval/publishing intent, or source-of-truth context → **ask Jay**.
- Missing public/source evidence → **call Surf**.
- Missing X/social signal → **call Surf X**.
- Missing final content copy → **call Echo**.
- Final strategic decision → **CMO only**.

## Decision rules

1. Surf and Surf X evidence cannot directly decide KEEP / CUT / TEST / SCALE / WAIT.
2. If evidence is weak, CMO should use **WAIT** or a bounded **TEST**, not **SCALE**.
3. X signal alone must not justify durable repositioning.
4. Public/source evidence is preferred over social signal for strategic decisions.
5. Dune / Worldchain metrics remain the business source of truth for Holdstation Mini App.
6. Facebook / X / GA4 channel metrics belong to Holdstation Wallet unless explicitly re-scoped to Mini App.
7. Echo must not invent metrics or strategy; it executes the brief.

## Failure behavior

- Echo fails → do not fake final copy. Return blocker + Echo brief.
- Surf fails → do not fake research. Return blocker/evidence gaps/next checks.
- Surf X fails → do not fake X sentiment. Return blocker and suggest bounded retry.
- Max one Surf or Surf X evidence call per user message for now.
- No recursive Surf → CMO → Surf loops.
- Do not call Surf and Surf X in the same turn yet.
- Do not use Last30Days in orchestration yet.

## Examples

| Prompt | Expected route |
|---|---|
| `/echo Draft 3 X posts about activation` | Direct Echo |
| `/surf Find public sources about MiniKit wallet actions. Use official docs.` | Direct Surf |
| `/surf x World App mini apps DeFi last 7 days max 5` | Direct Surf X |
| `CMO, should we position Holdstation Mini App around World App DeFi? Find evidence first if needed.` | CMO → Surf → CMO |
| `CMO, are people on X talking about World App mini apps DeFi recently?` | CMO → Surf X → CMO |
| `Plan next week's campaign. I don't know goal, audience, source, or success metric.` | Need Clarification |
| `Draft 3 X posts about Holdstation Mini App activation.` | Echo/content route; no Surf unless evidence requested |
| `What should our activation strategy be next week?` | CMO only, unless CMO determines a source/evidence gap |

## Current locked phases

- Phase 2.10E: Hermes Echo execution bridge.
- Phase 2.10F: Direct Echo command.
- Phase 2.10G: Mention-aware CMO → Echo orchestration.
- Phase 2.10I: Direct Surf command and web-research hotfixes.
- Phase 2.10M: Direct Surf X command and timeout/default tuning.
- Phase 2.10N: CMO → Surf / Surf X evidence orchestration.
- Phase 2.10O: This routing policy and operating manual sync.

## Deferred items

- Last30Days CMO UI route.
- Radar integration.
- Surf + Surf X combined same-turn orchestration.
- Mission Control changes.
- Publishing/mutation actions.

## Production notes

- Production URL: `https://cmo.jayju.cloud`
- Service: `cmo-engine-dashboard.service`
- Repo: `/home/ju/cmo-engine-openclaw`
- Main route: `/apps/holdstation-mini-app?tab=sessions`
- Hermes endpoints currently used by CMO UI:
  - `POST /agents/echo/execute`
  - `POST /agents/surf/execute`
  - `POST /agents/surf-x/execute`
- Do not log `CMO_HERMES_API_KEY`.
- Do not commit runtime app-chat session JSON or unrelated runtime data.
