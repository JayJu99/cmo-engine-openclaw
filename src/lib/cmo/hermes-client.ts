export interface HermesEchoBrief {
  handoff_id: string;
  source_agent: "cmo" | "jay";
  target_agent: "echo";
  mode?: "direct_jay" | "echo.default" | "echo.source_translate";
  workspace: string;
  task_type: string;
  objective: string;
  platform?: string;
  content_count?: number;
  audience?: string;
  input?: unknown;
  input_material?: unknown;
  source_material?: unknown;
  context?: unknown;
  brief?: {
    angle?: string;
    [key: string]: unknown;
  };
  claim_boundaries?: string[];
  output_contract?: unknown;
  source_context: {
    metrics_source?: string;
    allowed_metrics?: string[];
    claim_constraints?: string[];
    raw_request: string;
    origin?: string;
    input_material?: unknown;
    source_material?: unknown;
    delegation_context?: unknown;
  };
  delegation?: Record<string, unknown>;
  raw_delegation?: Record<string, unknown>;
  tone?: string;
  deliverable?: {
    format: string;
    count: number;
    max_length: string;
  };
  constraints: string[];
  return_to: "cmo_engine";
  max_turns: number;
}


export interface HermesSurfBrief {
  handoff_id: string;
  source_agent: "jay" | "cmo";
  target_agent: "surf";
  mode?: "direct_jay" | "surf.default" | "surf.x" | "surf.trend" | "surf.pulse";
  workspace: string;
  task_type: string;
  objective: string;
  topic?: string;
  topics?: string[];
  surface?: string;
  entity?: string;
  query?: string;
  search_query?: string;
  output_contract?: unknown;
  research_mode?: "x_search" | "last30days";
  input?: Record<string, unknown>;
  input_material: unknown;
  source_material?: unknown;
  context?: unknown;
  allow_web_research: boolean;
  search_scope?: string;
  timeframe?: string;
  market?: string;
  category?: string;
  geography?: string;
  max_sources?: number;
  max_search_queries?: number;
  max_results?: number;
  allowed_sources?: Array<"reddit" | "hackernews" | "polymarket">;
  source_targets?: string[];
  competitors?: string[];
  source_context: {
    raw_request: string;
    origin: string;
    input_material?: unknown;
    source_material?: unknown;
    delegation_context?: unknown;
  };
  delegation?: Record<string, unknown>;
  raw_delegation?: Record<string, unknown>;
  constraints: string[];
  return_to: "cmo_engine";
  max_turns: number;
}

export interface HermesSurfXBrief {
  handoff_id: string;
  source_agent: "jay" | "cmo";
  target_agent: "surf";
  research_mode: "x_search";
  mode: "direct_jay" | "cmo_orchestrated";
  workspace: string;
  topic: string;
  objective: string;
  timeframe: string;
  max_results: number;
  constraints: string[];
  source_context: {
    raw_request: string;
    origin: string;
  };
  return_to: "cmo_engine";
  max_turns: number;
}

export interface HermesSurfLast30DaysBrief {
  handoff_id: string;
  source_agent: "jay" | "cmo";
  target_agent: "surf";
  research_mode: "last30days";
  mode: "direct_jay" | "cmo_orchestrated";
  workspace: string;
  topic: string;
  objective: string;
  timeframe: "last 30 days";
  max_results: number;
  allowed_sources: Array<"reddit" | "hackernews" | "polymarket">;
  constraints: string[];
  source_context: {
    raw_request: string;
    origin: string;
  };
  return_to: "cmo_engine";
  max_turns: number;
}

export interface HermesSurfResponse {
  schema_version?: "surf.response.v1";
  handoff_id: string;
  agent: "surf";
  mode?: "surf.default" | "surf.x" | "surf.trend" | "surf.pulse";
  status: "completed" | "failed" | "blocked";
  summary?: string;
  sources_used?: Array<Record<string, unknown> | string>;
  key_findings?: Array<Record<string, unknown> | string>;
  evidence_gaps?: Array<Record<string, unknown> | string>;
  recommended_next_checks?: Array<Record<string, unknown> | string>;
  notes?: Array<Record<string, unknown> | string>;
  blocker?: string;
  research_pack?: Record<string, unknown>;
  researchPack?: Record<string, unknown>;
  safety?: HermesSpecialistSafety;
}

export interface HermesSurfExecutionResult {
  ok: boolean;
  response?: HermesSurfResponse;
  failureReason?: string;
}

export interface HermesEchoOutput {
  label: string;
  copy: string;
}

export interface HermesEchoResponse {
  schema_version?: "echo.response.v1";
  handoff_id: string;
  agent: "echo";
  mode?: "echo.default" | "echo.source_translate";
  status: "completed";
  outputs: HermesEchoOutput[];
  notes: string[];
  safety?: HermesSpecialistSafety;
}

export interface HermesEchoExecutionResult {
  ok: boolean;
  response?: HermesEchoResponse;
  failureReason?: string;
}

interface HermesSpecialistSafety {
  published: false;
  vault_write: false;
  supabase_mutation: false;
  session_mutation: false;
  raw_capture: false;
  kanban: false;
  openclaw_call: false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export function isHermesExecutionEnabled(): boolean {
  return envEnabled(process.env.CMO_HERMES_EXECUTION_ENABLED);
}

function hermesTimeoutMs(): number {
  const value = Number.parseInt(process.env.CMO_HERMES_TIMEOUT_MS ?? "30000", 10);
  return Number.isFinite(value) && value > 0 ? value : 30000;
}

function hermesSurfXTimeoutMs(): number {
  const value = Number.parseInt(process.env.CMO_HERMES_SURF_X_TIMEOUT_MS ?? "180000", 10);
  return Number.isFinite(value) && value > 0 ? value : 180000;
}

function hermesLast30DaysTimeoutMs(): number {
  const value = Number.parseInt(process.env.CMO_HERMES_LAST30DAYS_TIMEOUT_MS ?? "180000", 10);
  return Number.isFinite(value) && value > 0 ? value : 180000;
}

function validateSpecialistSafety(value: unknown): value is HermesSpecialistSafety {
  return (
    isRecord(value) &&
    value.published === false &&
    value.vault_write === false &&
    value.supabase_mutation === false &&
    value.session_mutation === false &&
    value.raw_capture === false &&
    value.kanban === false &&
    value.openclaw_call === false
  );
}

function specialistFailureReason(value: unknown, agentLabel: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const status = typeof value.status === "string" ? value.status : "";

  if (status !== "failed" && status !== "blocked") {
    return null;
  }

  return structuredErrorMessage(value) ?? `${agentLabel} returned status ${status}.`;
}

function normalizeEchoOutput(output: unknown, index: number): HermesEchoOutput | null {
  if (typeof output === "string") {
    return { label: `output_${index + 1}`, copy: output };
  }

  if (!isRecord(output)) {
    return null;
  }

  const label =
    typeof output.label === "string"
      ? output.label
      : typeof output.title === "string"
        ? output.title
        : typeof output.type === "string"
          ? output.type
          : `output_${index + 1}`;
  const copy =
    typeof output.copy === "string"
      ? output.copy
      : typeof output.content === "string"
        ? output.content
        : typeof output.text === "string"
          ? output.text
          : typeof output.markdown === "string"
            ? output.markdown
            : compactText(JSON.stringify(output), 2000);

  return copy ? { label, copy } : null;
}

function validateHermesEchoResponse(value: unknown): HermesEchoResponse | null {
  if (!isRecord(value) || value.agent !== "echo" || value.status !== "completed") {
    return null;
  }

  if (value.schema_version !== undefined && value.schema_version !== "echo.response.v1") {
    return null;
  }

  if (value.mode !== undefined && value.mode !== "echo.default" && value.mode !== "echo.source_translate") {
    return null;
  }

  if (
    (value.schema_version === "echo.response.v1" && !validateSpecialistSafety(value.safety)) ||
    (value.safety !== undefined && !validateSpecialistSafety(value.safety))
  ) {
    return null;
  }

  const handoffId =
    typeof value.handoff_id === "string"
      ? value.handoff_id
      : typeof value.handoffId === "string"
        ? value.handoffId
        : value.schema_version === "echo.response.v1"
          ? "echo_response"
          : "";
  const outputs = Array.isArray(value.outputs)
    ? value.outputs.map(normalizeEchoOutput).filter((output): output is HermesEchoOutput => Boolean(output))
    : [];
  const notes = Array.isArray(value.notes) ? value.notes.filter((note): note is string => typeof note === "string") : [];

  if (!handoffId || !Array.isArray(value.outputs) || (value.schema_version !== "echo.response.v1" && outputs.length === 0)) {
    return null;
  }

  return {
    ...(value.schema_version === "echo.response.v1" ? { schema_version: "echo.response.v1" } : {}),
    handoff_id: handoffId,
    agent: "echo",
    ...(value.mode === "echo.default" || value.mode === "echo.source_translate" ? { mode: value.mode } : {}),
    status: "completed",
    outputs,
    notes,
    ...(validateSpecialistSafety(value.safety) ? { safety: value.safety } : {}),
  };
}

function compactText(value: string, max = 500): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function structuredErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["error", "message", "detail", "blocker", "reason", "failure_reason", "failureReason"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key].trim();
    }
  }

  if (typeof value.code === "string" && value.code.trim()) {
    return value.code.trim();
  }

  return null;
}

async function hermesHttpFailureReason(response: Response, agentLabel: string): Promise<string> {
  let detail = "";

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await response.json() as unknown;
      detail = structuredErrorMessage(data) ?? compactText(JSON.stringify(data));
    } else {
      detail = compactText(await response.text());
    }
  } catch {
    detail = "";
  }

  const base = `${agentLabel} returned HTTP ${response.status}.`;
  const category = response.status === 502
    ? " Upstream gateway/runtime error from Hermes or its reverse proxy."
    : response.status === 404
      ? " Endpoint not found; check Hermes route configuration."
      : response.status === 401 || response.status === 403
        ? " Authentication/authorization failed; check Hermes API key configuration."
        : "";

  return detail ? `${base}${category} Detail: ${detail}` : `${base}${category}`;
}

export async function executeHermesEcho(brief: HermesEchoBrief): Promise<HermesEchoExecutionResult> {
  const baseUrl = process.env.CMO_HERMES_BASE_URL?.replace(/\/+$/g, "");
  const apiKey = process.env.CMO_HERMES_API_KEY;

  if (!isHermesExecutionEnabled()) {
    return { ok: false, failureReason: "Hermes execution is disabled." };
  }

  if (!baseUrl) {
    return { ok: false, failureReason: "CMO_HERMES_BASE_URL is not configured." };
  }

  if (!apiKey) {
    return { ok: false, failureReason: "CMO_HERMES_API_KEY is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hermesTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}/agents/echo/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(brief),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, failureReason: await hermesHttpFailureReason(response, "Hermes Echo") };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, failureReason: "Hermes Echo returned invalid JSON." };
    }

    const failureReason = specialistFailureReason(data, "Hermes Echo");
    if (failureReason) {
      return { ok: false, failureReason };
    }

    const validated = validateHermesEchoResponse(data);

    if (!validated) {
      return { ok: false, failureReason: "Hermes Echo response did not match the completed Echo contract." };
    }

    return { ok: true, response: validated };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, failureReason: "Hermes Echo request timed out." };
    }

    return { ok: false, failureReason: error instanceof Error ? error.message : "Hermes Echo request failed." };
  } finally {
    clearTimeout(timeout);
  }
}
function validateHermesSurfResponse(value: unknown): HermesSurfResponse | null {
  if (!isRecord(value) || value.agent !== "surf" || value.status !== "completed") {
    return null;
  }

  const mode = value.mode;
  const validMode = mode === "surf.default" || mode === "surf.x" || mode === "surf.trend" || mode === "surf.pulse";

  if (value.schema_version !== undefined && value.schema_version !== "surf.response.v1") {
    return null;
  }

  if (mode !== undefined && !validMode) {
    return null;
  }

  if (
    (value.schema_version === "surf.response.v1" && !validateSpecialistSafety(value.safety)) ||
    (value.safety !== undefined && !validateSpecialistSafety(value.safety))
  ) {
    return null;
  }

  const handoffId =
    typeof value.handoff_id === "string"
      ? value.handoff_id
      : typeof value.handoffId === "string"
        ? value.handoffId
        : value.schema_version === "surf.response.v1"
          ? "surf_response"
          : "";

  if (!handoffId) {
    return null;
  }

  const researchPack = isRecord(value.research_pack) ? value.research_pack : isRecord(value.researchPack) ? value.researchPack : undefined;

  if (value.schema_version === "surf.response.v1" && !researchPack) {
    return null;
  }

  const list = (input: unknown): Array<Record<string, unknown> | string> => Array.isArray(input) ? input.filter((item): item is Record<string, unknown> | string => typeof item === "string" || isRecord(item)) : [];

  return {
    ...(value.schema_version === "surf.response.v1" ? { schema_version: "surf.response.v1" } : {}),
    handoff_id: handoffId,
    agent: "surf",
    ...(validMode ? { mode } : {}),
    status: "completed",
    summary: typeof value.summary === "string" ? value.summary : typeof researchPack?.summary === "string" ? researchPack.summary : undefined,
    sources_used: list(value.sources_used ?? researchPack?.sources_used),
    key_findings: list(value.key_findings ?? researchPack?.key_findings),
    evidence_gaps: list(value.evidence_gaps ?? researchPack?.evidence_gaps),
    recommended_next_checks: list(value.recommended_next_checks ?? researchPack?.recommended_next_checks),
    notes: list(value.notes),
    blocker: typeof value.blocker === "string" ? value.blocker : typeof researchPack?.blocker === "string" ? researchPack.blocker : undefined,
    ...(researchPack ? { research_pack: researchPack } : {}),
    ...(validateSpecialistSafety(value.safety) ? { safety: value.safety } : {}),
  };
}

export async function executeHermesSurf(brief: HermesSurfBrief): Promise<HermesSurfExecutionResult> {
  const baseUrl = process.env.CMO_HERMES_BASE_URL?.replace(/\/+$/g, "");
  const apiKey = process.env.CMO_HERMES_API_KEY;

  if (!isHermesExecutionEnabled()) {
    return { ok: false, failureReason: "Hermes execution is disabled." };
  }

  if (!baseUrl) {
    return { ok: false, failureReason: "CMO_HERMES_BASE_URL is not configured." };
  }

  if (!apiKey) {
    return { ok: false, failureReason: "CMO_HERMES_API_KEY is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hermesTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}/agents/surf/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(brief),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, failureReason: await hermesHttpFailureReason(response, "Hermes Surf") };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, failureReason: "Hermes Surf returned invalid JSON." };
    }

    const failureReason = specialistFailureReason(data, "Hermes Surf");
    if (failureReason) {
      return { ok: false, failureReason };
    }

    const validated = validateHermesSurfResponse(data);

    if (!validated) {
      return { ok: false, failureReason: "Hermes Surf response did not match the Surf research contract." };
    }

    return { ok: true, response: validated };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, failureReason: "Hermes Surf request timed out." };
    }

    return { ok: false, failureReason: error instanceof Error ? error.message : "Hermes Surf request failed." };
  } finally {
    clearTimeout(timeout);
  }
}
export async function executeHermesSurfLast30Days(brief: HermesSurfLast30DaysBrief): Promise<HermesSurfExecutionResult> {
  const baseUrl = process.env.CMO_HERMES_BASE_URL?.replace(/\/+$/g, "");
  const apiKey = process.env.CMO_HERMES_API_KEY;

  if (!isHermesExecutionEnabled()) {
    return { ok: false, failureReason: "Hermes execution is disabled." };
  }

  if (!baseUrl) {
    return { ok: false, failureReason: "CMO_HERMES_BASE_URL is not configured." };
  }

  if (!apiKey) {
    return { ok: false, failureReason: "CMO_HERMES_API_KEY is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hermesLast30DaysTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}/agents/surf-last30days/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(brief),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, failureReason: await hermesHttpFailureReason(response, "Hermes Surf Last30Days") };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, failureReason: "Hermes Surf Last30Days returned invalid JSON." };
    }

    const failureReason = specialistFailureReason(data, "Hermes Surf Last30Days");
    if (failureReason) {
      return { ok: false, failureReason };
    }

    const validated = validateHermesSurfResponse(data);

    if (!validated) {
      return { ok: false, failureReason: "Hermes Surf Last30Days response did not match the Surf research contract." };
    }

    return { ok: true, response: validated };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, failureReason: "Hermes Surf Last30Days request timed out. Try narrowing the topic or increase CMO_HERMES_LAST30DAYS_TIMEOUT_MS." };
    }

    return { ok: false, failureReason: error instanceof Error ? error.message : "Hermes Surf Last30Days request failed." };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeHermesSurfX(brief: HermesSurfXBrief): Promise<HermesSurfExecutionResult> {
  const baseUrl = process.env.CMO_HERMES_BASE_URL?.replace(/\/+$/g, "");
  const apiKey = process.env.CMO_HERMES_API_KEY;

  if (!isHermesExecutionEnabled()) {
    return { ok: false, failureReason: "Hermes execution is disabled." };
  }

  if (!baseUrl) {
    return { ok: false, failureReason: "CMO_HERMES_BASE_URL is not configured." };
  }

  if (!apiKey) {
    return { ok: false, failureReason: "CMO_HERMES_API_KEY is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hermesSurfXTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}/agents/surf-x/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(brief),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, failureReason: await hermesHttpFailureReason(response, "Hermes Surf X") };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, failureReason: "Hermes Surf X returned invalid JSON." };
    }

    const failureReason = specialistFailureReason(data, "Hermes Surf X");
    if (failureReason) {
      return { ok: false, failureReason };
    }

    const validated = validateHermesSurfResponse(data);

    if (!validated) {
      return { ok: false, failureReason: "Hermes Surf X response did not match the Surf research contract." };
    }

    return { ok: true, response: validated };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, failureReason: "Hermes Surf X request timed out. X Search can take longer than normal Surf. Try narrowing the query with \"last 7 days max 5\" or increase CMO_HERMES_SURF_X_TIMEOUT_MS." };
    }

    return { ok: false, failureReason: error instanceof Error ? error.message : "Hermes Surf X request failed." };
  } finally {
    clearTimeout(timeout);
  }
}

