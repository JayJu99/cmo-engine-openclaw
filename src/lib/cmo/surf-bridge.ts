import type { CMOAppChatRequest, CMOAppChatResponse } from "@/lib/cmo/app-workspace-types";
import {
  executeHermesSurf,
  executeHermesSurfLast30Days,
  executeHermesSurfX,
  type HermesSurfBrief,
  type HermesSurfLast30DaysBrief,
  type HermesSurfResponse,
  type HermesSurfXBrief,
} from "@/lib/cmo/hermes-client";

interface SurfBridgeResult {
  handled: boolean;
  response?: Pick<CMOAppChatResponse, "answer" | "assumptions" | "suggestedActions" | "runtimeProvider" | "runtimeAgent" | "isRuntimeFallback" | "runtimeError">;
}

function parseDirectSurfXCommand(message: string): string | null {
  const trimmed = message.trim();
  const match = trimmed.match(/^(?:(?:\/surf|@surf)\s+x|\/x)(?:\s+([\s\S]*))?$/i);

  if (!match) {
    return null;
  }

  return (match[1] ?? "").trim();
}

function parseDirectTrendCommand(message: string): string | null {
  const trimmed = message.trim();
  const match = trimmed.match(/^\/trend(?:\s+([\s\S]*))?$/i);

  if (!match) {
    return null;
  }

  return (match[1] ?? "").trim();
}

function parseDirectPulseCommand(message: string): string | null {
  const trimmed = message.trim();
  const match = trimmed.match(/^\/pulse(?:\s+([\s\S]*))?$/i);

  if (!match) {
    return null;
  }

  return (match[1] ?? "").trim();
}

function parseDirectSurfCommand(message: string): string | null {
  const trimmed = message.trim();
  const match = trimmed.match(/^(?:\/surf|@surf)(?:\s+([\s\S]*))?$/i);

  if (!match) {
    return null;
  }

  return (match[1] ?? "").trim();
}

function normalized(message: string): string {
  return message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function projectContextFromRequest(request: CMOAppChatRequest) {
  const workspaceId = request.workspaceId || request.appId;
  const notes = request.context.selectedNotes
    .filter((note) => note.selected !== false && note.exists !== false)
    .filter((note) => !note.path || note.path.includes(`/Workspace Lessons/${workspaceId}/`) || note.path.includes(`/${workspaceId}/`))
    .map((note) => ({
      title: note.title,
      path: note.path,
      reason: note.reason,
      preview: note.contentPreview,
      context_quality: note.contextQuality,
    }))
    .filter((note) => note.preview || note.path);

  return {
    workspace_id: workspaceId,
    app_id: request.appId,
    app_name: request.appName,
    selected_project_context: notes,
  };
}

function explicitWebResearch(message: string): boolean {
  const text = normalized(message);
  const publicSourceIntent = /\b(find public sources?|public sources?|public information|public examples?|official docs?|official documentation|official pages?|web research|research public|search web|find sources?|sources? about|browse|urls?|links?|website|docs?|documentation)\b/.test(text);
  const researchPublicThing = /^\s*research\b/.test(text) && /\b(public|sources?|competitors?|ecosystem|world app|worldcoin|minikit|morpho|add money|eggs vault|credit|apps?)\b/.test(text);
  const namedWorldAppTargets = /\bworld app\b/.test(text) && /\b(morpho|add money|eggs vault|credit|minikit|trading|swap|defi|wallet|onchain)\b/.test(text);

  return publicSourceIntent || researchPublicThing || namedWorldAppTargets;
}

function extractAfterLabel(message: string, label: string): string | undefined {
  const match = message.match(new RegExp(`${label}\\s*[:=-]\\s*([^\\n.]+)`, "i"));

  return match?.[1]?.trim();
}

function extractMaxSources(message: string): number | undefined {
  const match = message.match(/max\s*(\d+)\s*sources?/i) ?? message.match(/tối đa\s*(\d+)\s*nguồn/i);
  const value = match ? Number.parseInt(match[1], 10) : NaN;

  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function inferMarket(message: string): string | undefined {
  return /\b(world app|worldcoin)\b/i.test(message) ? "World App / Worldcoin ecosystem" : undefined;
}

function inferCategory(message: string): string | undefined {
  const hits = ["trading", "swap", "DeFi", "wallet", "onchain", "MiniKit"].filter((term) => new RegExp(`\\b${term}\\b`, "i").test(message));

  return hits.length ? hits.join(", ") : undefined;
}

function extractSearchScope(message: string): string | undefined {
  return extractAfterLabel(message, "scope") ?? (explicitWebResearch(message) ? message.trim() : undefined);
}

function extractNamedTargets(message: string): string[] {
  const match = message.match(/about\s+(.+?)\s+(?:mini apps?\s+)?in\s+World App/i);

  if (!match) {
    return [];
  }

  return match[1]
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractXTimeframe(topic: string): string {
  const match = topic.match(/last\s+(\d+)\s+days?/i);

  return match ? `last ${Number.parseInt(match[1], 10)} days` : "last 30 days";
}

function extractMaxResults(topic: string): number {
  const match = topic.match(/max\s+(\d+)/i);
  const value = match ? Number.parseInt(match[1], 10) : NaN;

  return Number.isFinite(value) && value > 0 ? value : 5;
}

function buildDirectSurfXBrief(request: CMOAppChatRequest, topic: string): HermesSurfXBrief {
  const projectContext = projectContextFromRequest(request);
  return {
    handoff_id: `direct_surf_x_${Date.now()}`,
    source_agent: "jay",
    target_agent: "surf",
    research_mode: "x_search",
    mode: "direct_jay",
    workspace: projectContext.workspace_id,
    topic,
    objective: `Search X read-only for recent public posts about ${topic} and structure social signal for CMO.`,
    timeframe: extractXTimeframe(topic),
    max_results: extractMaxResults(topic),
    constraints: [
      "Read-only X search",
      "Do not treat social posts as verified facts",
      "Do not make final strategic decision",
      "Do not publish",
      "Do not update Vault/App Memory/tasks",
    ],
    source_context: {
      raw_request: topic,
      origin: "cmo_engine_direct_surf_x_command",
      workspace_id: projectContext.workspace_id,
      app_id: projectContext.app_id,
      app_name: projectContext.app_name,
      delegation_context: projectContext,
    },
    return_to: "cmo_engine",
    max_turns: 1,
  };
}

function extractInputMaterial(objective: string): string[] {
  const labeled = objective.match(/(?:input|notes?)\s*[:=-]\s*([\s\S]+)/i)?.[1]?.trim();

  return [labeled || objective].filter(Boolean);
}

function buildDirectLast30DaysBrief(request: CMOAppChatRequest, topic: string): HermesSurfLast30DaysBrief {
  const projectContext = projectContextFromRequest(request);
  return {
    handoff_id: `direct_surf_last30days_${Date.now()}`,
    source_agent: "jay",
    target_agent: "surf",
    research_mode: "last30days",
    mode: "direct_jay",
    workspace: projectContext.workspace_id,
    topic,
    objective: `Search Reddit, HackerNews, and Polymarket only for last-30-days community trend signals about ${topic}.`,
    timeframe: "last 30 days",
    max_results: extractMaxResults(topic),
    allowed_sources: ["reddit", "hackernews", "polymarket"],
    constraints: [
      "Safe sandbox mode only",
      "Use Reddit, HackerNews, and Polymarket only",
      "Do not use X",
      "Do not use xurl",
      "Do not use browser cookies",
      "Do not treat weak community signals as verified facts",
      "Do not make final strategic decision",
      "Do not publish",
      "Do not update Vault/App Memory/tasks",
    ],
    source_context: {
      raw_request: topic,
      origin: "cmo_engine_direct_trend_command",
      workspace_id: projectContext.workspace_id,
      app_id: projectContext.app_id,
      app_name: projectContext.app_name,
      delegation_context: projectContext,
    },
    return_to: "cmo_engine",
    max_turns: 1,
  };
}

export function buildDirectSurfBrief(request: CMOAppChatRequest, objective: string): HermesSurfBrief {
  const allowWebResearch = explicitWebResearch(objective);
  const maxSources = extractMaxSources(objective) ?? (allowWebResearch ? 5 : undefined);
  const sourceTargets = extractNamedTargets(objective);
  const projectContext = projectContextFromRequest(request);

  return {
    handoff_id: `direct_surf_${Date.now()}`,
    source_agent: "jay",
    target_agent: "surf",
    mode: "direct_jay",
    workspace: projectContext.workspace_id,
    task_type: "research_pack",
    objective,
    input_material: allowWebResearch ? [] : extractInputMaterial(objective),
    allow_web_research: allowWebResearch,
    ...(extractSearchScope(objective) ? { search_scope: extractSearchScope(objective) } : {}),
    ...(extractAfterLabel(objective, "timeframe") ? { timeframe: extractAfterLabel(objective, "timeframe") } : allowWebResearch ? { timeframe: "current public information" } : {}),
    ...(extractAfterLabel(objective, "market") ? { market: extractAfterLabel(objective, "market") } : inferMarket(objective) ? { market: inferMarket(objective) } : {}),
    ...(extractAfterLabel(objective, "category") ? { category: extractAfterLabel(objective, "category") } : inferCategory(objective) ? { category: inferCategory(objective) } : {}),
    ...(extractAfterLabel(objective, "geography") ? { geography: extractAfterLabel(objective, "geography") } : {}),
    ...(maxSources ? { max_sources: maxSources, max_search_queries: 3 } : {}),
    ...(sourceTargets.length ? { source_targets: sourceTargets, competitors: sourceTargets } : {}),
    source_context: {
      raw_request: objective,
      origin: "cmo_engine_direct_surf_command",
      workspace_id: projectContext.workspace_id,
      app_id: projectContext.app_id,
      app_name: projectContext.app_name,
      delegation_context: projectContext,
    },
    constraints: [
      "Do not invent unsupported sources, metrics, competitors, or claims",
      "Do not make final strategic decision",
      "Do not publish",
      "Do not update Vault/App Memory/tasks",
    ],
    return_to: "cmo_engine",
    max_turns: 1,
  };
}

function last30DaysBriefMarkdown(brief: HermesSurfLast30DaysBrief): string {
  return [
    `handoff_id: ${brief.handoff_id}`,
    `target_agent: ${brief.target_agent}`,
    `research_mode: ${brief.research_mode}`,
    `workspace: ${brief.workspace}`,
    `timeframe: ${brief.timeframe}`,
    `max_results: ${brief.max_results}`,
    `allowed_sources: ${brief.allowed_sources.join(", ")}`,
    `topic: ${brief.topic}`,
    `objective: ${brief.objective}`,
    "constraints:",
    ...brief.constraints.map((constraint) => `- ${constraint}`),
  ].join("\n");
}

function surfXBriefMarkdown(brief: HermesSurfXBrief): string {
  return [
    `handoff_id: ${brief.handoff_id}`,
    `target_agent: ${brief.target_agent}`,
    `research_mode: ${brief.research_mode}`,
    `workspace: ${brief.workspace}`,
    `timeframe: ${brief.timeframe}`,
    `max_results: ${brief.max_results}`,
    `topic: ${brief.topic}`,
    `objective: ${brief.objective}`,
    "constraints:",
    ...brief.constraints.map((constraint) => `- ${constraint}`),
  ].join("\n");
}

function briefMarkdown(brief: HermesSurfBrief): string {
  return [
    `handoff_id: ${brief.handoff_id}`,
    `target_agent: ${brief.target_agent}`,
    `workspace: ${brief.workspace}`,
    `task_type: ${brief.task_type}`,
    `allow_web_research: ${brief.allow_web_research}`,
    ...(brief.search_scope ? [`search_scope: ${brief.search_scope}`] : []),
    ...(brief.timeframe ? [`timeframe: ${brief.timeframe}`] : []),
    ...(brief.market ? [`market: ${brief.market}`] : []),
    ...(brief.category ? [`category: ${brief.category}`] : []),
    ...(brief.geography ? [`geography: ${brief.geography}`] : []),
    ...(brief.max_sources ? [`max_sources: ${brief.max_sources}`] : []),
    ...(brief.source_targets?.length ? [`source_targets: ${brief.source_targets.join(", ")}`] : []),
    `objective: ${brief.objective}`,
    "constraints:",
    ...brief.constraints.map((constraint) => `- ${constraint}`),
  ].join("\n");
}

function valueString(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function recordValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = valueString(record[key]);

    if (value) {
      return value;
    }
  }

  return "";
}

function renderSource(source: Record<string, unknown> | string): string {
  if (typeof source === "string") {
    return `- ${source}`;
  }

  const title = recordValue(source, ["title", "name", "publisher", "url"]) || "Source";
  const url = recordValue(source, ["url", "link"]);
  const publisher = recordValue(source, ["publisher", "source", "domain"]);
  const sourceType = recordValue(source, ["source_type", "type"]);
  const facts = source.relevant_facts;
  const limitations = source.limitations;
  const details = [publisher, sourceType].filter(Boolean).join(" / ");
  const lines = [`- ${title}${url ? ` — ${url}` : ""}${details ? ` (${details})` : ""}`];

  if (Array.isArray(facts) && facts.length) {
    lines.push(`  - Relevant facts: ${facts.map((item) => valueString(item)).filter(Boolean).join("; ")}`);
  } else if (typeof facts === "string") {
    lines.push(`  - Relevant facts: ${facts}`);
  }

  if (Array.isArray(limitations) && limitations.length) {
    lines.push(`  - Limitations: ${limitations.map((item) => valueString(item)).filter(Boolean).join("; ")}`);
  } else if (typeof limitations === "string") {
    lines.push(`  - Limitations: ${limitations}`);
  }

  return lines.join("\n");
}

function renderFinding(finding: Record<string, unknown> | string): string {
  if (typeof finding === "string") {
    return `- ${finding}`;
  }

  const category = recordValue(finding, ["category", "theme"]);
  const body = recordValue(finding, ["finding", "summary", "text", "claim"]) || JSON.stringify(finding);
  const evidence = finding.evidence;
  const lines = [`- ${category ? `${category}: ` : ""}${body}`];

  if (Array.isArray(evidence) && evidence.length) {
    lines.push(`  - Evidence: ${evidence.map((item) => valueString(item)).filter(Boolean).join("; ")}`);
  } else if (typeof evidence === "string") {
    lines.push(`  - Evidence: ${evidence}`);
  }

  return lines.join("\n");
}

function renderGap(gap: Record<string, unknown> | string): string {
  if (typeof gap === "string") {
    return `- ${gap}`;
  }

  return `- ${recordValue(gap, ["gap", "issue", "text", "summary"]) || JSON.stringify(gap)}`;
}

function renderNextCheck(check: Record<string, unknown> | string): string {
  if (typeof check === "string") {
    return `- ${check}`;
  }

  return `- ${recordValue(check, ["check", "next_check", "action", "text", "summary"]) || JSON.stringify(check)}`;
}

function renderNote(note: Record<string, unknown> | string): string {
  if (typeof note === "string") {
    return `- ${note}`;
  }

  return `- ${recordValue(note, ["note", "message", "text", "summary"]) || JSON.stringify(note)}`;
}

function renderSurfResponse(response: HermesSurfResponse): string {
  const pack = response.research_pack ?? response.researchPack ?? {};
  const summary = response.summary ?? valueString(pack.summary) ?? response.blocker ?? "No summary returned.";
  const sources = response.sources_used?.length ? response.sources_used : [];
  const findings = response.key_findings?.length ? response.key_findings : [];
  const gaps = response.evidence_gaps?.length ? response.evidence_gaps : [];
  const nextChecks = response.recommended_next_checks?.length ? response.recommended_next_checks : [];
  const notes = response.notes?.length ? response.notes : response.blocker ? [`Blocker: ${response.blocker}`] : [];

  return [
    "## Agent Execution",
    "",
    "- Surf used in Direct Jay Mode.",
    "- CMO was not invoked for strategic decisioning.",
    "",
    "## Research Pack",
    "",
    "### Summary",
    "",
    summary,
    "",
    "### Sources Used",
    "",
    ...(sources.length ? sources.map(renderSource) : ["- None reported."]),
    "",
    "### Key Findings",
    "",
    ...(findings.length ? findings.map(renderFinding) : ["- None reported."]),
    "",
    "### Evidence Gaps",
    "",
    ...(gaps.length ? gaps.map(renderGap) : ["- None reported."]),
    "",
    "### Recommended Next Checks",
    "",
    ...(nextChecks.length ? nextChecks.map(renderNextCheck) : ["- None reported."]),
    "",
    "### Optional Notes",
    "",
    ...(notes.length ? notes.map(renderNote) : ["- None."]),
  ].join("\n").trim();
}

function renderSurfXResponse(response: HermesSurfResponse): string {
  return renderSurfResponse(response).replace(
    "- Surf used in Direct Jay Mode.\n- CMO was not invoked for strategic decisioning.",
    "- Surf X used in Direct Jay Mode.\n- X Search was used in read-only mode.\n- CMO was not invoked for strategic decisioning."
  ) + "\n\n- X posts are social signal, not verified facts.";
}

function renderLast30DaysResponse(response: HermesSurfResponse): string {
  return renderSurfResponse(response).replace(
    "- Surf used in Direct Jay Mode.\n- CMO was not invoked for strategic decisioning.",
    "- Surf Last30Days used in Direct Jay Mode.\n- Last30Days sandbox mode was used.\n- Sources are restricted to Reddit, HackerNews, and Polymarket.\n- X was not used.\n- Browser cookies were not used.\n- CMO was not invoked for strategic decisioning."
  ) + "\n\n- Last30Days results are community/market trend signals, not verified facts.";
}

function renderPulseResponse(last30: { ok: boolean; response?: HermesSurfResponse; failureReason?: string }, x: { ok: boolean; response?: HermesSurfResponse; failureReason?: string }): string {
  const gaps = [
    ...(last30.response?.evidence_gaps ?? []),
    ...(x.response?.evidence_gaps ?? []),
    ...(!last30.ok ? [`Last30Days blocker: ${last30.failureReason ?? "unknown failure"}`] : []),
    ...(!x.ok ? [`Surf X blocker: ${x.failureReason ?? "unknown failure"}`] : []),
  ];
  const nextChecks = [
    ...(last30.response?.recommended_next_checks ?? []),
    ...(x.response?.recommended_next_checks ?? []),
  ];

  return [
    "## Agent Execution",
    "",
    "- Pulse used in Direct Jay Mode.",
    "- Last30Days sandbox and Surf X were requested as separate read-only research branches.",
    "- CMO was not invoked for strategic decisioning.",
    "- No final strategic decision was made.",
    "",
    "## Research Pack",
    "",
    "### Last30Days Community Trend",
    "",
    last30.response ? renderLast30DaysResponse(last30.response).replace(/^## Agent Execution[\s\S]*?## Research Pack\n+/, "") : `Blocker: ${last30.failureReason ?? "Hermes Surf Last30Days execution failed."}`,
    "",
    "### X Social Signal",
    "",
    x.response ? renderSurfXResponse(x.response).replace(/^## Agent Execution[\s\S]*?## Research Pack\n+/, "") : `Blocker: ${x.failureReason ?? "Hermes Surf X execution failed."}`,
    "",
    "### Combined Evidence Gaps",
    "",
    ...(gaps.length ? gaps.map(renderGap) : ["- None reported."]),
    "",
    "### Recommended Next Checks",
    "",
    ...(nextChecks.length ? nextChecks.map(renderNextCheck) : ["- None reported."]),
    "",
    "### Optional Notes",
    "",
    "- Last30Days used Reddit/HackerNews/Polymarket only; X/xurl/browser cookies were not used by that branch.",
    "- X posts are social signal, not verified facts.",
  ].join("\n").trim();
}

function unavailableLast30DaysAnswer(reason: string, brief: HermesSurfLast30DaysBrief): string {
  return [
    "## Agent Execution",
    "",
    "- Surf Last30Days unavailable in Direct Jay Mode.",
    "- Last30Days sandbox mode was intended to use Reddit, HackerNews, and Polymarket only.",
    "- X was not used.",
    "- Browser cookies were not used.",
    "- CMO was not invoked for strategic decisioning.",
    "",
    "## Research Pack",
    "",
    `Blocker: ${reason}`,
    "",
    "## Research Brief",
    "",
    last30DaysBriefMarkdown(brief),
    "",
    "## Optional Notes",
    "",
    "- No fallback CMO research or strategy was generated.",
  ].join("\n");
}

function unavailableSurfXAnswer(reason: string, brief: HermesSurfXBrief): string {
  return [
    "## Agent Execution",
    "",
    "- Surf X unavailable in Direct Jay Mode.",
    "- X Search was intended to run in read-only mode.",
    "- CMO was not invoked for strategic decisioning.",
    "",
    "## Research Pack",
    "",
    `Blocker: ${reason}`,
    "",
    "## Research Brief",
    "",
    surfXBriefMarkdown(brief),
    "",
    "## Optional Notes",
    "",
    "- No fallback CMO research or strategy was generated.",
    "- Normal Surf was not used as a fallback.",
  ].join("\n");
}

function unavailableAnswer(reason: string, brief: HermesSurfBrief): string {
  return [
    "## Agent Execution",
    "",
    "- Surf unavailable in Direct Jay Mode.",
    "- CMO was not invoked for strategic decisioning.",
    "",
    "## Research Pack",
    "",
    `Blocker: ${reason}`,
    "",
    "## Research Brief",
    "",
    briefMarkdown(brief),
    "",
    "## Optional Notes",
    "",
    "- No fallback CMO research or strategy was generated.",
  ].join("\n");
}

export async function maybeHandleSurfBridge(request: CMOAppChatRequest): Promise<SurfBridgeResult> {
  const trendTopic = parseDirectTrendCommand(request.message);

  if (trendTopic !== null) {
    if (!trendTopic) {
      return { handled: true, response: { answer: "## Agent Execution\n\n- Direct Last30Days command detected.\n- CMO was not invoked for strategic decisioning.\n\n## Research Pack\n\nPlease add the community trend topic after `/trend`.", assumptions: [], suggestedActions: [{ type: "direct_trend_empty", label: "Provide the trend topic for Last30Days." }], runtimeProvider: "hermes", runtimeAgent: "surf-last30days", isRuntimeFallback: false } };
    }
    const brief = buildDirectLast30DaysBrief(request, trendTopic);
    const result = await executeHermesSurfLast30Days(brief);
    if (!result.ok || !result.response) {
      const reason = result.failureReason ?? "Hermes Surf Last30Days execution failed.";
      return { handled: true, response: { answer: unavailableLast30DaysAnswer(reason, brief), assumptions: [], suggestedActions: [{ type: "direct_trend_retry", label: "Recover Hermes Last30Days and retry the trend command." }], runtimeProvider: "hermes", runtimeAgent: "surf-last30days", isRuntimeFallback: true, runtimeError: reason } };
    }
    return { handled: true, response: { answer: renderLast30DaysResponse(result.response), assumptions: [], suggestedActions: [{ type: "direct_trend_completed", label: "Review Last30Days community trend research pack." }], runtimeProvider: "hermes", runtimeAgent: "surf-last30days", isRuntimeFallback: false } };
  }

  const pulseTopic = parseDirectPulseCommand(request.message);

  if (pulseTopic !== null) {
    if (!pulseTopic) {
      return { handled: true, response: { answer: "## Agent Execution\n\n- Direct Pulse command detected.\n- CMO was not invoked for strategic decisioning.\n\n## Research Pack\n\nPlease add the pulse research topic after `/pulse`.", assumptions: [], suggestedActions: [{ type: "direct_pulse_empty", label: "Provide the topic for Pulse." }], runtimeProvider: "hermes", runtimeAgent: "surf-last30days+surf-x", isRuntimeFallback: false } };
    }
    const last30Brief = buildDirectLast30DaysBrief(request, pulseTopic);
    const xBrief = buildDirectSurfXBrief(request, pulseTopic);
    const [last30Result, xResult] = await Promise.all([executeHermesSurfLast30Days(last30Brief), executeHermesSurfX(xBrief)]);
    const failed = !last30Result.ok || !last30Result.response || !xResult.ok || !xResult.response;
    return { handled: true, response: { answer: renderPulseResponse(last30Result, xResult), assumptions: [], suggestedActions: [{ type: failed ? "direct_pulse_partial" : "direct_pulse_completed", label: failed ? "Review available Pulse branch and retry failed branch if needed." : "Review combined Pulse research pack." }], runtimeProvider: "hermes", runtimeAgent: "surf-last30days+surf-x", isRuntimeFallback: failed, runtimeError: failed ? [last30Result.failureReason, xResult.failureReason].filter(Boolean).join("; ") : undefined } };
  }

  const surfXTopic = parseDirectSurfXCommand(request.message);

  if (surfXTopic !== null) {
    if (!surfXTopic) {
      return {
        handled: true,
        response: {
          answer: [
            "## Agent Execution",
            "",
            "- Direct Surf X command detected.",
            "- CMO was not invoked for strategic decisioning.",
            "",
            "## Research Pack",
            "",
            "Please add the X/social research topic after `/x`, `/surf x`, or `@surf x`.",
          ].join("\n"),
          assumptions: [],
          suggestedActions: [{ type: "direct_surf_x_empty", label: "Provide the X/social research topic for Surf X." }],
          runtimeProvider: "hermes",
          runtimeAgent: "surf-x",
          isRuntimeFallback: false,
        },
      };
    }

    const brief = buildDirectSurfXBrief(request, surfXTopic);
    const result = await executeHermesSurfX(brief);

    if (!result.ok || !result.response) {
      const reason = result.failureReason ?? "Hermes Surf X execution failed.";

      return {
        handled: true,
        response: {
          answer: unavailableSurfXAnswer(reason, brief),
          assumptions: [],
          suggestedActions: [{ type: "direct_surf_x_retry", label: "Recover Hermes Surf X and retry the direct Surf X command." }],
          runtimeProvider: "hermes",
          runtimeAgent: "surf-x",
          isRuntimeFallback: true,
          runtimeError: reason,
        },
      };
    }

    return {
      handled: true,
      response: {
        answer: renderSurfXResponse(result.response),
        assumptions: [],
        suggestedActions: [{ type: "direct_surf_x_completed", label: "Review Surf X social signal research pack." }],
        runtimeProvider: "hermes",
        runtimeAgent: "surf-x",
        isRuntimeFallback: false,
      },
    };
  }

  const objective = parseDirectSurfCommand(request.message);

  if (objective === null) {
    return { handled: false };
  }

  if (!objective) {
    return {
      handled: true,
      response: {
        answer: [
          "## Agent Execution",
          "",
          "- Direct Surf command detected.",
          "- CMO was not invoked for strategic decisioning.",
          "",
          "## Research Pack",
          "",
          "Please add the research/source task after `/surf` or `@surf`.",
        ].join("\n"),
        assumptions: [],
        suggestedActions: [{ type: "direct_surf_empty", label: "Provide the research task for Surf." }],
        runtimeProvider: "hermes",
        runtimeAgent: "surf",
        isRuntimeFallback: false,
      },
    };
  }

  const brief = buildDirectSurfBrief(request, objective);
  const result = await executeHermesSurf(brief);

  if (!result.ok || !result.response) {
    const reason = result.failureReason ?? "Hermes Surf execution failed.";

    return {
      handled: true,
      response: {
        answer: unavailableAnswer(reason, brief),
        assumptions: [],
        suggestedActions: [{ type: "direct_surf_retry", label: "Recover Hermes Surf and retry the direct Surf command." }],
        runtimeProvider: "hermes",
        runtimeAgent: "surf",
        isRuntimeFallback: true,
        runtimeError: reason,
      },
    };
  }

  return {
    handled: true,
    response: {
      answer: renderSurfResponse(result.response),
      assumptions: [],
      suggestedActions: [{ type: "direct_surf_completed", label: "Review Surf research pack." }],
      runtimeProvider: "hermes",
      runtimeAgent: "surf",
      isRuntimeFallback: false,
    },
  };
}
