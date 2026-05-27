import type { CMOAppChatRequest } from "@/lib/cmo/app-workspace-types";
import { executeHermesSurf, executeHermesSurfX, type HermesSurfBrief, type HermesSurfResponse, type HermesSurfXBrief } from "@/lib/cmo/hermes-client";

type EvidenceAction = "need_clarification" | "call_surf" | "call_surf_x" | "answer_directly";

export interface CmoSurfPlan {
  action: EvidenceAction;
  reason: string;
  clarificationQuestions: string[];
  surfBrief?: HermesSurfBrief;
  surfXBrief?: HermesSurfXBrief;
}

export interface CmoSurfEvidenceResult {
  plan: CmoSurfPlan;
  response?: HermesSurfResponse;
  failureReason?: string;
}

function normalized(message: string): string {
  return message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function directOrContentCommand(message: string): boolean {
  return /^\s*(?:\/surf|@surf|\/echo|@echo)\b/i.test(message);
}

function asksForStrategy(text: string): boolean {
  return /\b(cmo|strategy|strategic|position|positioning|narrative|diagnosis|decision|decide|plan|campaign|activation|growth|should we|recommend|priorit|phan tich|chien luoc|dinh huong|quyet dinh|co nen|nen)\b/.test(text);
}

function asksForContentOnly(text: string): boolean {
  return /\b(draft|write|copy|caption|post|thread|email|script|rewrite|variant)\b/.test(text) && !/\b(evidence|source|research|verify|competitor|landscape|docs?|official|x|twitter|sentiment|buzz)\b/.test(text);
}

function needsClarification(text: string): boolean {
  return /\b(i don'?t know|not sure|unclear|missing|chua ro|khong ro|khong chac|don'?t know goal|no goal|without goal)\b/.test(text);
}

function wantsSurfX(text: string): boolean {
  return /\b(x|twitter|social signal|community is saying|people are talking|sentiment|buzz|recent posts|crypto twitter)\b/.test(text);
}

function wantsSurf(text: string): boolean {
  return /\b(research|source|sources|public sources|docs?|official docs?|competitor|landscape|compare|verify|evidence|what do we know about|find public information|market scan|world app defi)\b/.test(text);
}

function inferMarket(message: string): string | undefined {
  return /\b(world app|worldcoin)\b/i.test(message) ? "World App / Worldcoin ecosystem" : undefined;
}

function inferCategory(message: string): string | undefined {
  const hits = ["trading", "swap", "DeFi", "wallet", "onchain", "MiniKit", "activation", "narrative"].filter((term) => new RegExp(`\\b${term}\\b`, "i").test(message));
  return hits.length ? hits.join(", ") : undefined;
}

function maxResults(message: string, fallback: number): number {
  const match = message.match(/max\s+(\d+)/i);
  const value = match ? Number.parseInt(match[1], 10) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function timeframe(message: string, fallback: string): string {
  const match = message.match(/last\s+(\d+)\s+days?/i);
  return match ? `last ${Number.parseInt(match[1], 10)} days` : fallback;
}

function buildSurfBrief(request: CMOAppChatRequest): HermesSurfBrief {
  return {
    handoff_id: `cmo_surf_${Date.now()}`,
    source_agent: "cmo",
    target_agent: "surf",
    workspace: "holdstation-mini-app",
    task_type: "research_pack",
    objective: `Gather source evidence for CMO strategic decision: ${request.message}`,
    input_material: [],
    allow_web_research: true,
    search_scope: request.message,
    timeframe: /\b(this week|next week|current|recent|public|today|now)\b/i.test(request.message) ? "current public information" : undefined,
    ...(inferMarket(request.message) ? { market: inferMarket(request.message) } : {}),
    ...(inferCategory(request.message) ? { category: inferCategory(request.message) } : {}),
    max_sources: 5,
    max_search_queries: 3,
    source_context: { raw_request: request.message, origin: "cmo_engine_cmo_surf_orchestration" },
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

function buildSurfXBrief(request: CMOAppChatRequest): HermesSurfXBrief {
  return {
    handoff_id: `cmo_surf_x_${Date.now()}`,
    source_agent: "jay",
    target_agent: "surf",
    research_mode: "x_search",
    mode: "direct_jay",
    workspace: "holdstation-mini-app",
    topic: request.message,
    objective: `Search X read-only for recent public posts about ${request.message} and structure social signal for CMO evidence review.`,
    timeframe: timeframe(request.message, "last 30 days"),
    max_results: maxResults(request.message, 5),
    constraints: [
      "Read-only X search",
      "Do not treat social posts as verified facts",
      "Do not make final strategic decision",
      "Do not publish",
      "Do not update Vault/App Memory/tasks",
    ],
    source_context: { raw_request: request.message, origin: "cmo_engine_cmo_surf_x_orchestration" },
    return_to: "cmo_engine",
    max_turns: 1,
  };
}

export function planCmoSurfEvidence(request: CMOAppChatRequest): CmoSurfPlan {
  const text = normalized(request.message);

  if (directOrContentCommand(request.message) || asksForContentOnly(text)) {
    return { action: "answer_directly", reason: "Direct command or content-only request should use existing routing.", clarificationQuestions: [] };
  }

  if (!asksForStrategy(text)) {
    return { action: "answer_directly", reason: "Not a strategic request.", clarificationQuestions: [] };
  }

  if (needsClarification(text)) {
    return {
      action: "need_clarification",
      reason: "Decision-critical user context is explicitly missing.",
      clarificationQuestions: [
        "What is the main goal for this decision?",
        "Who is the target audience or segment?",
        "What success metric should CMO optimize for?",
      ],
    };
  }

  if (wantsSurfX(text)) {
    return { action: "call_surf_x", reason: "Strategic request asks for X/social signal before decision.", clarificationQuestions: [], surfXBrief: buildSurfXBrief(request) };
  }

  if (wantsSurf(text)) {
    return { action: "call_surf", reason: "Strategic request asks for external/source evidence before decision.", clarificationQuestions: [], surfBrief: buildSurfBrief(request) };
  }

  return { action: "answer_directly", reason: "Strategic request appears answerable from existing context.", clarificationQuestions: [] };
}

function list(items: Array<Record<string, unknown> | string> | undefined, fallback = "- None reported."): string[] {
  if (!items?.length) return [fallback];
  return items.slice(0, 5).map((item) => typeof item === "string" ? `- ${item}` : `- ${String(item.title ?? item.finding ?? item.gap ?? item.check ?? item.url ?? JSON.stringify(item))}`);
}

export function buildCmoEvidenceRuntimeMessage(originalMessage: string, evidence: CmoSurfEvidenceResult): string {
  const response = evidence.response;
  const pack = response?.research_pack ?? response?.researchPack ?? {};
  const summary = response?.summary ?? (typeof pack.summary === "string" ? pack.summary : undefined) ?? evidence.failureReason ?? "No evidence summary returned.";
  const sources = response?.sources_used;
  const findings = response?.key_findings;
  const gaps = response?.evidence_gaps;
  const checks = response?.recommended_next_checks;
  const signalLabel = evidence.plan.action === "call_surf_x" ? "Surf X social signal" : "Surf source evidence";

  return [
    originalMessage,
    "",
    "CMO evidence orchestration instruction:",
    `- ${signalLabel} was gathered before final diagnosis.`,
    "- Use Surf output as evidence only. CMO owns diagnosis and decision.",
    "- Do not overclaim. If evidence is weak, use WAIT or ask for next checks.",
    "- Include sections: Agent Execution, Surf Research Used, Strategic Read, Diagnosis, Decision: KEEP / CUT / TEST / SCALE / WAIT, Missions / Next Actions, Memory Update.",
    evidence.plan.action === "call_surf_x" ? "- Label X posts as social signal, not verified facts." : "- Treat official/source evidence as support, not automatic strategy.",
    "",
    "Surf Research Used:",
    `Summary: ${summary}`,
    "Sources:",
    ...list(sources),
    "Key Findings:",
    ...list(findings),
    "Evidence Gaps:",
    ...list(gaps),
    "Recommended Next Checks:",
    ...list(checks),
  ].join("\n");
}

export async function executeCmoSurfEvidence(request: CMOAppChatRequest): Promise<CmoSurfEvidenceResult> {
  const plan = planCmoSurfEvidence(request);

  if (plan.action === "call_surf" && plan.surfBrief) {
    const result = await executeHermesSurf(plan.surfBrief);
    return { plan, response: result.response, failureReason: result.ok ? undefined : result.failureReason };
  }

  if (plan.action === "call_surf_x" && plan.surfXBrief) {
    const result = await executeHermesSurfX(plan.surfXBrief);
    return { plan, response: result.response, failureReason: result.ok ? undefined : result.failureReason };
  }

  return { plan };
}
