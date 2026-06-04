import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { getCmoHermesApiKey, getCmoHermesBaseUrl, getCmoHermesTimeoutMs } from "./config";
import type { CMOAppChatResponse, CMOChatMessage, HermesCmoChatMetadata } from "./app-workspace-types";
import { mapCmoChatToHermesCmoRequest, type HermesCmoChatRequestInput } from "./hermes-cmo-chat-mapper";
import { HERMES_CMO_CHAT_V11_ENDPOINT } from "./hermes-cmo-chat-router";

const CHAT_REQUEST_SCHEMA = "hermes.cmo.chat.request.v1_1" as const;
const CHAT_RESPONSE_SCHEMA = "hermes.cmo.chat.response.v1_1" as const;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_SESSION_SUMMARY_CHARS = 6_000;
const MAX_ARTIFACTS = 20;
const MAX_ARTIFACT_JSON_CHARS = 12_000;
const MAX_SUGGESTED_VAULT_UPDATES = 12;
const MAX_CONTRACT_WARNINGS = 20;
const MAX_CONTRACT_WARNING_CHARS = 240;
const MAX_SESSION_SUMMARY_LINES = 80;
const MAX_SESSION_SUMMARY_LIST_ITEMS = 12;
const UNSAFE_ARTIFACT_KEYS =
  /^(api_key|authorization|body|content|cookie|cookies|credential|credentials|env|file_body|file_content|full_content|full_source|full_text|headers|html|markdown|password|private_key|raw|raw_.*|secret|secrets|source_text.*|text|token|tool_args|tool_result)$/i;
const SIDE_EFFECT_KEYS = [
  "executed_echo",
  "executed_surf",
  "executed_vault_agent",
  "vault_context_retrieval",
  "vault_write",
  "raw_runtime_write",
  "knowledge_write",
  "accepted_knowledge_write",
  "memory_mutation",
  "gbrain_mutation",
  "source_auto_save",
  "knowledge_promotion",
  "supabase_mutation",
  "session_mutation",
  "raw_capture",
  "repo_mutation",
  "kanban",
  "openclaw",
  "publishing",
] as const;
const SIDE_EFFECT_KEY_SET = new Set<string>(SIDE_EFFECT_KEYS);

type HermesCmoChatV11SideEffects = Record<(typeof SIDE_EFFECT_KEYS)[number], boolean>;

export interface HermesCmoChatV11RequestInput extends HermesCmoChatRequestInput {
  sessionSummary?: string;
  sessionArtifacts?: Record<string, unknown>[];
  vaultContext?: unknown;
}

export interface HermesCmoChatV11Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface HermesCmoChatV11SessionSummary {
  schema_version: "cmo.session_summary.v1";
  summary: string;
  active_subjects: string[];
  decisions: string[];
  open_questions: string[];
  comparison_sets: string[];
  corrections: string[];
  superseded_items: string[];
  user_corrections: string[];
  source_refs: string[];
  artifact_refs: string[];
  vault_refs: string[];
}

export interface HermesCmoChatV11Request {
  schema_version: typeof CHAT_REQUEST_SCHEMA;
  request_id: string;
  session_id: string;
  turn_id: string;
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  user_id: string;
  intent: {
    user_message: string;
  };
  messages: HermesCmoChatV11Message[];
  context_pack: {
    session_summary: HermesCmoChatV11SessionSummary | null;
    artifacts_in: Record<string, unknown>[];
    vault_context: unknown;
  };
  options: {
    mode: "cmo.normal_chat";
  };
  tool_policy: {
    mode: "cmo.normal_chat";
    allow_vault_write: false;
    allow_memory_mutation: false;
    allow_surf_delegation: false;
    read_web_allowed: boolean;
    read_browser_allowed: boolean;
  };
}

export interface HermesCmoChatV11Response {
  schema_version: typeof CHAT_RESPONSE_SCHEMA;
  mode: "cmo.chat";
  status: "completed" | "failed";
  answer: {
    content: string;
    [key: string]: unknown;
  };
  user_visible?: {
    answer?: string;
    semantic_state?: unknown;
    vault_internals_hidden?: boolean;
    [key: string]: unknown;
  };
  artifacts_out: Record<string, unknown>[];
  suggested_session_summary_update?: unknown;
  suggested_vault_updates: Record<string, unknown>[];
  vault_context_usage?: unknown;
  contract_warnings: string[];
  contract_warnings_count: number;
  state_contract?: Record<string, unknown>;
  artifacts_out_count: number;
  artifact_refs_count: number;
  decisions_count: number;
  suggested_vault_updates_count: number;
  side_effects: HermesCmoChatV11SideEffects;
}

export interface HermesCmoChatV11RunResult {
  ok: true;
  request: HermesCmoChatV11Request;
  response: HermesCmoChatV11Response;
  metadata: HermesCmoChatMetadata;
}

export interface HermesCmoChatV11RunFailure {
  ok: false;
  request?: HermesCmoChatV11Request;
  fallbackEligible: boolean;
  fallbackReason: string;
}

export type HermesCmoChatV11Run = HermesCmoChatV11RunResult | HermesCmoChatV11RunFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const traceDirectory = () => {
  const configured = process.env.CMO_HERMES_CMO_TRACE_DIR?.trim();

  return configured
    ? path.resolve(configured)
    : path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "cmo-dashboard", "hermes-cmo-traces");
};

const safeTraceId = (value: string) => value.replace(/[^a-z0-9_.-]+/gi, "_").slice(0, 96) || "unknown";

function compactText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3).trimEnd()}...` : compact;
}

function compactMultilineText(value: string, maxChars: number): string {
  const compact = value
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return compact.length > maxChars ? `${compact.slice(0, maxChars - 3).trimEnd()}...` : compact;
}

const traceValue = (value: unknown, depth = 0, parentKey?: string): unknown => {
  if (typeof value === "string") {
    return compactText(value, 1_200);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => traceValue(item, depth + 1, parentKey));
  }

  if (depth >= 6 || !isRecord(value)) {
    return "[object_redacted]";
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (parentKey === "side_effects" && SIDE_EFFECT_KEY_SET.has(key) && typeof item === "boolean") {
        return [key, item];
      }

      if (
        /api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|token/i.test(key) ||
        UNSAFE_ARTIFACT_KEYS.test(key)
      ) {
        return [key, "[redacted]"];
      }

      return [key, traceValue(item, depth + 1, key)];
    }),
  );
};

const chatResponseTraceSummary = (payload: unknown): Record<string, unknown> => {
  const root = isRecord(payload) ? payload : {};
  const response = isRecord(root.response) ? root.response : root;
  const sideEffects = response.side_effects ?? root.side_effects;
  const vaultContextUsage = response.vault_context_usage;
  const contractWarnings = sanitizedContractWarnings(response.contract_warnings);
  const stateContract = isRecord(response.state_contract) ? safeRecord(response.state_contract, 6_000) : null;

  return {
    response_schema_version: response.schema_version,
    mode: response.mode,
    status: response.status,
    ...(sideEffects !== undefined ? { side_effects: sideEffects } : {}),
    ...(vaultContextUsage !== undefined ? { vault_context_usage: vaultContextUsage } : {}),
    contract_warnings: contractWarnings,
    contract_warnings_count: contractWarnings.length,
    ...(stateContract ? { state_contract: stateContract } : {}),
    artifacts_out_count: nonNegativeInteger(response.artifacts_out_count) ?? (Array.isArray(response.artifacts_out) ? response.artifacts_out.length : 0),
    artifact_refs_count: nonNegativeInteger(response.artifact_refs_count) ?? artifactRefsCount(response),
    decisions_count: nonNegativeInteger(response.decisions_count) ?? decisionsCount(response),
    session_summary_update_present: response.suggested_session_summary_update !== undefined,
    suggested_vault_updates_count: nonNegativeInteger(response.suggested_vault_updates_count) ??
      (Array.isArray(response.suggested_vault_updates) ? response.suggested_vault_updates.length : 0),
  };
};

const hermesCmoChatV11TracePath = (request: HermesCmoChatV11Request, suffix: string) =>
  path.join(
    traceDirectory(),
    `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeTraceId(request.app_id)}_${safeTraceId(request.session_id)}_${safeTraceId(request.turn_id)}_${suffix}.json`,
  );

export async function writeHermesCmoChatV11Trace(
  request: HermesCmoChatV11Request,
  suffix: "request" | "response" | "error" | "fallback",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const filePath = hermesCmoChatV11TracePath(request, suffix);
    const traceRoot = {
      schema_version: CHAT_REQUEST_SCHEMA,
      endpoint_kind: "agent_chat",
      runtime_kind: "ai_agent",
      requested_endpoint: HERMES_CMO_CHAT_V11_ENDPOINT,
      request_id: request.request_id,
      session_id: request.session_id,
      turn_id: request.turn_id,
      tenant_id: request.tenant_id,
      workspace_id: request.workspace_id,
      app_id: request.app_id,
      fallback_used: false,
      side_effects: emptySideEffects(),
      contract_warnings: [],
      contract_warnings_count: 0,
      artifacts_out_count: 0,
      artifact_refs_count: 0,
      decisions_count: 0,
      session_summary_update_present: false,
      suggested_vault_updates_count: 0,
      request,
      ...payload,
    };

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(traceValue(traceRoot), null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn("[hermes-cmo-chat-v11] Failed to write safe Hermes CMO chat trace.", {
      requestId: request.request_id,
      sessionId: request.session_id,
      turnId: request.turn_id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function writeHermesCmoChatV11FallbackTrace(
  request: HermesCmoChatV11Request | undefined,
  input: {
    fallbackReason: string;
    fallbackResponse?: unknown;
    sideEffects?: unknown;
    artifactsOutCount?: number;
    sessionSummaryUpdatePresent?: boolean;
    suggestedVaultUpdatesCount?: number;
  },
): Promise<void> {
  if (!request) {
    return;
  }

  await writeHermesCmoChatV11Trace(request, "fallback", {
    event: "fallback",
    fallback_used: true,
    fallback_reason: input.fallbackReason,
    fallback_from: HERMES_CMO_CHAT_V11_ENDPOINT,
    fallback_to: "/agents/cmo/execute",
    response: input.fallbackResponse,
    side_effects: input.sideEffects ?? emptySideEffects(),
    contract_warnings: [],
    contract_warnings_count: 0,
    artifacts_out_count: input.artifactsOutCount ?? 0,
    artifact_refs_count: 0,
    decisions_count: 0,
    session_summary_update_present: input.sessionSummaryUpdatePresent === true,
    suggested_vault_updates_count: input.suggestedVaultUpdatesCount ?? 0,
  });
}

function userId(input: HermesCmoChatV11RequestInput): string {
  return (
    input.userIdentity?.userId?.trim() ||
    input.userIdentity?.userEmail?.trim() ||
    input.userIdentity?.createdByEmail?.trim() ||
    "legacy_dashboard_user"
  );
}

function tenantId(input: HermesCmoChatV11RequestInput): string {
  return input.request.tenantId?.trim() || "holdstation";
}

function sanitizedMessages(history: CMOChatMessage[], current: { id: string; content: string; createdAt: string }): HermesCmoChatV11Message[] {
  const messages = [
    ...history
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        id: message.id,
        role: message.role as "user" | "assistant",
        content: compactText(message.content, MAX_MESSAGE_CHARS),
        ...(message.createdAt ? { created_at: message.createdAt } : {}),
      })),
    {
      id: current.id,
      role: "user" as const,
      content: compactText(current.content, MAX_MESSAGE_CHARS),
      created_at: current.createdAt,
    },
  ].filter((message) => message.content);

  return messages.slice(-MAX_MESSAGES);
}

function stringListFromUnknown(value: unknown, maxItems = 12, maxItemChars = 300): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (!isRecord(item)) {
        return "";
      }

      for (const key of ["summary", "statement", "title", "name", "question", "decision", "id", "ref", "path"]) {
        if (typeof item[key] === "string" && item[key].trim()) {
          return item[key];
        }
      }

      return JSON.stringify(safeRecord(item, 1_000) ?? {});
    })
    .map((item) => compactText(item, maxItemChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function dedupeStrings(values: string[], maxItems = MAX_SESSION_SUMMARY_LIST_ITEMS): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const compact = compactText(value, 300);
    const key = compact.toLowerCase();

    if (!compact || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(compact);
  }

  return result.slice(-maxItems);
}

const SESSION_SUMMARY_LABELS: Record<string, keyof Pick<
  HermesCmoChatV11SessionSummary,
  "active_subjects" | "decisions" | "open_questions" | "comparison_sets" | "corrections" | "superseded_items" | "artifact_refs" | "vault_refs"
>> = {
  "active subjects": "active_subjects",
  decisions: "decisions",
  "open questions": "open_questions",
  "comparison sets": "comparison_sets",
  corrections: "corrections",
  "superseded items": "superseded_items",
  "artifact refs": "artifact_refs",
  "vault refs": "vault_refs",
};

function parsedSessionSummaryLists(summary: string): Pick<
  HermesCmoChatV11SessionSummary,
  "active_subjects" | "decisions" | "open_questions" | "comparison_sets" | "corrections" | "superseded_items" | "artifact_refs" | "vault_refs"
> {
  const lists = {
    active_subjects: [] as string[],
    decisions: [] as string[],
    open_questions: [] as string[],
    comparison_sets: [] as string[],
    corrections: [] as string[],
    superseded_items: [] as string[],
    artifact_refs: [] as string[],
    vault_refs: [] as string[],
  };

  for (const line of summary.split(/\r?\n/)) {
    const match = line.trim().match(/^([^:]{3,80}):\s*(.+)$/);

    if (!match) {
      continue;
    }

    const key = SESSION_SUMMARY_LABELS[match[1].trim().toLowerCase()];

    if (!key) {
      continue;
    }

    lists[key].push(...match[2].split(";").map((item) => item.trim()).filter(Boolean));
  }

  const supersededItems = dedupeStrings(lists.superseded_items);
  const activeComparisonSets = dedupeStrings(lists.comparison_sets).filter((item) =>
    !supersededItems.some((superseded) => item.toLowerCase().includes(superseded.toLowerCase())),
  );

  return {
    active_subjects: dedupeStrings(lists.active_subjects),
    decisions: dedupeStrings(lists.decisions),
    open_questions: dedupeStrings(lists.open_questions),
    comparison_sets: activeComparisonSets,
    corrections: dedupeStrings(lists.corrections),
    superseded_items: supersededItems,
    artifact_refs: dedupeStrings(lists.artifact_refs),
    vault_refs: dedupeStrings(lists.vault_refs),
  };
}

function structuredSessionSummary(summary: string | null): HermesCmoChatV11SessionSummary | null {
  if (!summary?.trim()) {
    return null;
  }

  const lists = parsedSessionSummaryLists(summary);

  return {
    schema_version: "cmo.session_summary.v1",
    summary: compactMultilineText(summary, MAX_SESSION_SUMMARY_CHARS),
    active_subjects: lists.active_subjects,
    decisions: lists.decisions,
    open_questions: lists.open_questions,
    comparison_sets: lists.comparison_sets,
    corrections: lists.corrections,
    superseded_items: lists.superseded_items,
    user_corrections: lists.corrections,
    source_refs: [],
    artifact_refs: lists.artifact_refs,
    vault_refs: lists.vault_refs,
  };
}

function safeRecord(
  value: Record<string, unknown>,
  maxJsonChars = MAX_ARTIFACT_JSON_CHARS,
  options: { allowTopLevelContent?: boolean } = {},
  depth = 0,
): Record<string, unknown> | null {
  const safe: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (UNSAFE_ARTIFACT_KEYS.test(key)) {
      if (options.allowTopLevelContent && depth === 0 && key === "content" && typeof nested === "string" && nested.trim()) {
        safe[key] = compactText(nested, 4_000);
      }

      continue;
    }

    if (typeof nested === "string") {
      safe[key] = compactText(nested, 1_200);
    } else if (typeof nested === "number" || typeof nested === "boolean" || nested === null) {
      safe[key] = nested;
    } else if (Array.isArray(nested)) {
      safe[key] = nested
        .slice(0, 12)
        .map((item) => typeof item === "string" ? compactText(item, 500) : isRecord(item) ? safeRecord(item, 2_000, options, depth + 1) : item)
        .filter((item) => item !== undefined && item !== null);
    } else if (isRecord(nested)) {
      const nestedSafe = safeRecord(nested, 2_000, options, depth + 1);
      if (nestedSafe) {
        safe[key] = nestedSafe;
      }
    }
  }

  if (!Object.keys(safe).length) {
    return null;
  }

  const json = JSON.stringify(safe);
  if (json.length <= maxJsonChars) {
    return safe;
  }

  return {
    type: typeof safe.type === "string" ? safe.type : "hermes_cmo_artifact",
    truncated: true,
    summary: compactText(json, maxJsonChars),
  };
}

function sanitizedContractWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => typeof item === "string" ? compactText(item, MAX_CONTRACT_WARNING_CHARS) : "")
    .filter(Boolean)
    .slice(0, MAX_CONTRACT_WARNINGS);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

function artifactRefsCount(response: Record<string, unknown>): number {
  const update = isRecord(response.suggested_session_summary_update) ? response.suggested_session_summary_update : {};
  const stateContract = isRecord(response.state_contract) ? response.state_contract : {};

  if (Array.isArray(update.artifact_refs)) {
    return update.artifact_refs.length;
  }

  if (Array.isArray(stateContract.artifact_refs)) {
    return stateContract.artifact_refs.length;
  }

  return 0;
}

function decisionsCount(response: Record<string, unknown>): number {
  const update = isRecord(response.suggested_session_summary_update) ? response.suggested_session_summary_update : {};
  const stateContract = isRecord(response.state_contract) ? response.state_contract : {};

  if (Array.isArray(update.decisions)) {
    return update.decisions.length;
  }

  if (Array.isArray(stateContract.decisions)) {
    return stateContract.decisions.length;
  }

  return 0;
}

export function sanitizeHermesCmoChatV11Records(
  value: unknown,
  maxItems = MAX_ARTIFACTS,
  options: { allowTopLevelContent?: boolean } = {},
): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .slice(0, maxItems)
        .map((item) => isRecord(item) ? safeRecord(item, MAX_ARTIFACT_JSON_CHARS, options) : null)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

export function mergeHermesCmoChatV11Artifacts(
  existing: Record<string, unknown>[] | undefined,
  next: Record<string, unknown>[],
): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();

  for (const artifact of [...(existing ?? []), ...next]) {
    const key = typeof artifact.artifact_id === "string"
      ? artifact.artifact_id
      : typeof artifact.id === "string"
        ? artifact.id
        : `${typeof artifact.type === "string" ? artifact.type : "artifact"}:${JSON.stringify(artifact).slice(0, 160)}`;
    byKey.set(key, artifact);
  }

  return Array.from(byKey.values()).slice(-MAX_ARTIFACTS);
}

function sessionSummaryUpdateText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return compactText(value, MAX_SESSION_SUMMARY_CHARS);
  }

  if (!isRecord(value)) {
    return null;
  }

  const lines: string[] = [];

  for (const key of ["summary_delta", "session_summary", "summary", "content", "text", "update"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      lines.push(compactText(value[key], MAX_SESSION_SUMMARY_CHARS));
      break;
    }
  }

  const listLabels: Array<[string, string]> = [
    ["active_subjects", "Active subjects"],
    ["decisions", "Decisions"],
    ["open_questions", "Open questions"],
    ["comparison_sets", "Comparison sets"],
    ["corrections", "Corrections"],
    ["superseded_items", "Superseded items"],
    ["artifact_refs", "Artifact refs"],
    ["vault_refs", "Vault refs"],
  ];

  for (const [key, label] of listLabels) {
    const items = stringListFromUnknown(value[key], 8, 220);

    if (items.length) {
      lines.push(`${label}: ${items.join("; ")}`);
    }
  }

  return lines.length ? compactMultilineText(lines.join("\n"), MAX_SESSION_SUMMARY_CHARS) : null;
}

export function mergeHermesCmoChatV11SessionSummary(existing: string | undefined, update: unknown): string | undefined {
  const updateText = sessionSummaryUpdateText(update);
  const current = typeof existing === "string" && existing.trim() ? compactMultilineText(existing, MAX_SESSION_SUMMARY_CHARS) : "";

  if (!updateText) {
    return current || undefined;
  }

  if (!current) {
    return updateText;
  }

  if (current.includes(updateText)) {
    return current;
  }

  const seen = new Set<string>();
  const lines = `${current}\n${updateText}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(-MAX_SESSION_SUMMARY_LINES);

  return compactMultilineText(lines.join("\n"), MAX_SESSION_SUMMARY_CHARS);
}

function emptySideEffects(): HermesCmoChatV11SideEffects {
  return Object.fromEntries(SIDE_EFFECT_KEYS.map((key) => [key, false])) as HermesCmoChatV11SideEffects;
}

function rawActivityLogSideEffectsAreSafe(value: unknown, requiresWrite: boolean): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (requiresWrite && (value.vault_write !== true || value.raw_runtime_write !== true)) {
    return false;
  }

  for (const key of [
    "knowledge_write",
    "accepted_knowledge_write",
    "gbrain_mutation",
    "knowledge_promotion",
    "source_auto_save",
    "memory_mutation",
    "supabase_mutation",
  ]) {
    if (value[key] !== false) {
      return false;
    }
  }

  return true;
}

function rawActivityLogReceiptIsSafe(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.schema_version !== "vault_agent.raw_activity_log_result.v1" || value.status !== "completed") {
    return false;
  }

  const rawActivityLogged = value.raw_activity_logged === true;
  const deduped = value.deduped === true;

  if (!rawActivityLogged && !deduped) {
    return false;
  }

  if (rawActivityLogged) {
    if (
      value.vault_write_performed !== true ||
      typeof value.vault_path !== "string" ||
      !value.vault_path.startsWith("90 Runtime/Raw Activity/") ||
      !rawActivityLogSideEffectsAreSafe(value.side_effects, true)
    ) {
      return false;
    }
  }

  if (!rawActivityLogged && deduped && value.vault_write_performed !== false) {
    return false;
  }

  if (typeof value.vault_path === "string" && !value.vault_path.startsWith("90 Runtime/Raw Activity/")) {
    return false;
  }

  return rawActivityLogSideEffectsAreSafe(value.side_effects, rawActivityLogged);
}

function sideEffectsAreSafe(value: unknown, rawActivityLog: unknown): HermesCmoChatV11SideEffects | null {
  if (value === undefined || value === false) {
    return emptySideEffects();
  }

  if (!isRecord(value)) {
    return null;
  }

  const rawActivityLogIsSafe = rawActivityLogReceiptIsSafe(rawActivityLog);
  const normalized = emptySideEffects();

  for (const key of SIDE_EFFECT_KEYS) {
    const item = value[key];

    if (item === undefined || item === false) {
      continue;
    }

    if ((key === "vault_write" || key === "raw_capture" || key === "raw_runtime_write") && item === true && rawActivityLogIsSafe) {
      normalized[key] = true;
      continue;
    }

    if (item !== false) {
      return null;
    }
  }

  if (value.published !== undefined && value.published !== false) {
    return null;
  }

  for (const [key, nested] of Object.entries(value)) {
    if ((key === "vault_write" || key === "raw_capture" || key === "raw_runtime_write") && nested === true && rawActivityLogIsSafe) {
      continue;
    }

    if (/^(vault|memory|gbrain|supabase|session|raw_capture|raw_runtime_write|repo|publish|knowledge|source_auto_save|executed_|kanban|openclaw)/i.test(key) && nested !== false) {
      return null;
    }
  }

  return normalized;
}

function unsafeTopLevelMutation(payload: Record<string, unknown>): string | null {
  for (const key of [
    "vault_write",
    "memory_mutation",
    "gbrain_mutation",
    "supabase_mutation",
    "session_mutation",
    "raw_capture",
    "repo_mutation",
    "publishing",
    "knowledge_promotion",
    "source_auto_save",
  ]) {
    if (payload[key] === true) {
      return `${key}=true`;
    }
  }

  return null;
}

export function normalizeHermesCmoChatV11Response(payload: unknown, request: HermesCmoChatV11Request): HermesCmoChatV11Response | string {
  if (!isRecord(payload)) {
    return "malformed_response:not_object";
  }

  const response = isRecord(payload.response) ? payload.response : payload;
  const unsafeMutation = unsafeTopLevelMutation(response);
  if (unsafeMutation) {
    return `unsafe_response:${unsafeMutation}`;
  }

  const answer = isRecord(response.answer) ? response.answer : {};
  const content = typeof answer.content === "string" ? answer.content.trim() : "";
  const userVisible = isRecord(response.user_visible) ? response.user_visible : null;
  const userVisibleAnswer = typeof userVisible?.answer === "string" && userVisible.answer.trim()
    ? compactText(userVisible.answer, MAX_MESSAGE_CHARS)
    : "";
  const sideEffects = sideEffectsAreSafe(response.side_effects ?? payload.side_effects, response.raw_activity_log ?? payload.raw_activity_log);
  const artifactsOut = sanitizeHermesCmoChatV11Records(response.artifacts_out, MAX_ARTIFACTS, { allowTopLevelContent: true });
  const suggestedVaultUpdates = sanitizeHermesCmoChatV11Records(response.suggested_vault_updates, MAX_SUGGESTED_VAULT_UPDATES);
  const contractWarnings = sanitizedContractWarnings(response.contract_warnings);
  const stateContract = isRecord(response.state_contract) ? safeRecord(response.state_contract, 6_000) : null;

  if (
    response.schema_version !== CHAT_RESPONSE_SCHEMA ||
    response.mode !== "cmo.chat" ||
    response.request_id !== undefined && response.request_id !== request.request_id ||
    response.session_id !== undefined && response.session_id !== request.session_id ||
    response.turn_id !== undefined && response.turn_id !== request.turn_id ||
    (response.status !== "completed" && response.status !== "failed")
  ) {
    return "malformed_response:contract";
  }

  if (!content) {
    return "missing_answer_content";
  }

  if (sideEffects === null) {
    return "unsafe_response:side_effects";
  }

  return {
    schema_version: CHAT_RESPONSE_SCHEMA,
    mode: "cmo.chat",
    status: response.status,
    answer: {
      ...answer,
      content,
    },
    ...(userVisible
      ? {
          user_visible: {
            ...(safeRecord(userVisible, 8_000) ?? {}),
            ...(userVisibleAnswer ? { answer: userVisibleAnswer } : {}),
            ...(typeof userVisible.vault_internals_hidden === "boolean" ? { vault_internals_hidden: userVisible.vault_internals_hidden } : {}),
          },
        }
      : {}),
    artifacts_out: artifactsOut,
    ...(response.suggested_session_summary_update !== undefined
      ? { suggested_session_summary_update: response.suggested_session_summary_update }
      : {}),
    suggested_vault_updates: suggestedVaultUpdates,
    ...(response.vault_context_usage !== undefined ? { vault_context_usage: response.vault_context_usage } : {}),
    contract_warnings: contractWarnings,
    contract_warnings_count: contractWarnings.length,
    ...(stateContract ? { state_contract: stateContract } : {}),
    artifacts_out_count: nonNegativeInteger(response.artifacts_out_count) ?? artifactsOut.length,
    artifact_refs_count: nonNegativeInteger(response.artifact_refs_count) ?? artifactRefsCount(response),
    decisions_count: nonNegativeInteger(response.decisions_count) ?? decisionsCount(response),
    suggested_vault_updates_count: nonNegativeInteger(response.suggested_vault_updates_count) ?? suggestedVaultUpdates.length,
    side_effects: sideEffects,
  };
}

export function buildHermesCmoChatV11Request(input: HermesCmoChatV11RequestInput): HermesCmoChatV11Request {
  const legacyRequest = mapCmoChatToHermesCmoRequest(input);
  const artifactsIn = sanitizeHermesCmoChatV11Records([
    ...(Array.isArray(legacyRequest.context_pack.artifacts_in) ? legacyRequest.context_pack.artifacts_in : []),
    ...(input.sessionArtifacts ?? []),
  ], MAX_ARTIFACTS, { allowTopLevelContent: true });
  const sessionSummaryText = input.sessionSummary?.trim()
    ? compactMultilineText(input.sessionSummary, MAX_SESSION_SUMMARY_CHARS)
    : typeof legacyRequest.context_pack.recent_session_summary === "string"
      ? compactMultilineText(legacyRequest.context_pack.recent_session_summary, MAX_SESSION_SUMMARY_CHARS)
      : null;

  return {
    schema_version: CHAT_REQUEST_SCHEMA,
    request_id: `req_cmo_chat_v11_${input.userMessageId}`,
    session_id: input.sessionId,
    turn_id: input.userMessageId,
    tenant_id: tenantId(input),
    workspace_id: input.request.workspaceId,
    app_id: input.request.appId,
    user_id: userId(input),
    intent: {
      user_message: input.message,
    },
    messages: sanitizedMessages(input.history, {
      id: input.userMessageId,
      content: input.message,
      createdAt: input.createdAt,
    }),
    context_pack: {
      session_summary: structuredSessionSummary(sessionSummaryText),
      artifacts_in: artifactsIn,
      vault_context: input.vaultContext ?? null,
    },
    options: {
      mode: "cmo.normal_chat",
    },
    tool_policy: {
      mode: "cmo.normal_chat",
      allow_vault_write: false,
      allow_memory_mutation: false,
      allow_surf_delegation: false,
      read_web_allowed: true,
      read_browser_allowed: true,
    },
  };
}

function baseMetadata(input: {
  requestId: string;
  responseStatus: string;
  sideEffects?: false | Record<string, boolean>;
  fallbackUsed: boolean;
  fallbackReason?: string;
  vaultContextUsage?: unknown;
  contractWarnings?: string[];
  stateContract?: Record<string, unknown>;
  artifactsOutCount?: number;
  artifactRefsCount?: number;
  decisionsCount?: number;
  sessionSummaryUpdatePresent?: boolean;
  suggestedVaultUpdatesCount?: number;
}): HermesCmoChatMetadata {
  const counters = {
    surfCalls: 0,
    echoCalls: 0,
    vaultAgentCalls: 0,
    vaultWrites: 0,
    directSupabaseMutations: 0,
    openclawCalls: 0,
  };
  const stateContract = input.stateContract ? safeRecord(input.stateContract, 6_000) : null;

  return {
    runtimeMode: "hermes_cmo",
    runtimeStatus: input.fallbackUsed ? "fallback" : "live",
    calledHermesCmo: true,
    hermesRequestSent: true,
    productRenderSource: input.fallbackUsed ? "fallback_after_hermes_failure" : "hermes_cmo",
    selectedHermesEndpoint: HERMES_CMO_CHAT_V11_ENDPOINT,
    hermesEndpointKind: "agent_chat",
    endpoint_kind: "agent_chat",
    runtime_kind: "ai_agent",
    requested_endpoint: HERMES_CMO_CHAT_V11_ENDPOINT,
    fallback_used: input.fallbackUsed,
    ...(input.fallbackReason ? { fallback_reason: input.fallbackReason } : {}),
    ...(input.fallbackUsed
      ? {
          fallback_from: HERMES_CMO_CHAT_V11_ENDPOINT,
          fallback_to: "/agents/cmo/execute",
        }
      : {}),
    ...(input.sideEffects !== undefined ? { sideEffects: input.sideEffects, side_effects: input.sideEffects } : {}),
    ...(input.vaultContextUsage !== undefined ? { vault_context_usage: input.vaultContextUsage } : {}),
    contract_warnings: input.contractWarnings ?? [],
    contract_warnings_count: input.contractWarnings?.length ?? 0,
    ...(stateContract ? { state_contract: stateContract } : {}),
    artifacts_out_count: input.artifactsOutCount ?? 0,
    artifact_refs_count: input.artifactRefsCount ?? 0,
    decisions_count: input.decisionsCount ?? 0,
    session_summary_update_present: input.sessionSummaryUpdatePresent === true,
    suggested_vault_updates_count: input.suggestedVaultUpdatesCount ?? 0,
    delegationsMode: "proposals_only",
    counters,
    forbiddenCounters: {
      vaultAgentCalls: 0,
      vaultWrites: 0,
      openclawCalls: 0,
      directSupabaseMutations: 0,
    },
    requestId: input.requestId,
    responseStatus: input.responseStatus,
    activityEventsCount: 0,
    activityEvents: [],
    delegationSummary: [],
    agentsUsed: ["cmo"],
    surfCalls: 0,
    echoCalls: 0,
  };
}

export function fallbackHermesCmoChatV11Metadata(requestId: string, fallbackReason: string): HermesCmoChatMetadata {
  return baseMetadata({
    requestId,
    responseStatus: "failed",
    fallbackUsed: true,
    fallbackReason,
    sideEffects: {
      vault_write: false,
      memory_mutation: false,
      gbrain_mutation: false,
      supabase_mutation: false,
      session_mutation: false,
      raw_capture: false,
      repo_mutation: false,
      publishing: false,
      knowledge_promotion: false,
      source_auto_save: false,
    },
  });
}

export function failedHermesCmoChatV11Metadata(requestId: string, failureReason: string): HermesCmoChatMetadata {
  return baseMetadata({
    requestId,
    responseStatus: "failed",
    fallbackUsed: false,
    fallbackReason: failureReason,
    sideEffects: {
      vault_write: false,
      memory_mutation: false,
      gbrain_mutation: false,
      supabase_mutation: false,
      session_mutation: false,
      raw_capture: false,
      repo_mutation: false,
      publishing: false,
      knowledge_promotion: false,
      source_auto_save: false,
    },
  });
}

export function mapHermesCmoChatV11ToChatResult(
  request: HermesCmoChatV11Request,
  response: HermesCmoChatV11Response,
): Pick<
  CMOAppChatResponse,
  "answer" | "assumptions" | "suggestedActions" | "runtimeStatus" | "runtimeMode" | "runtimeLabel" | "runtimeProvider" | "runtimeAgent" | "isDevelopmentFallback" | "isRuntimeFallback"
> & {
  metadata: HermesCmoChatMetadata;
  artifactsOut: Record<string, unknown>[];
  suggestedSessionSummaryUpdate?: unknown;
  suggestedVaultUpdates: Record<string, unknown>[];
} {
  return {
    answer: response.user_visible?.answer?.trim() || response.answer.content,
    assumptions: [],
    suggestedActions: [],
    runtimeStatus: response.status === "completed" ? "live" : "runtime_error",
    runtimeMode: response.status === "completed" ? "live" : "configured_but_unreachable",
    runtimeLabel: "Hermes CMO chat v1.1",
    runtimeProvider: "hermes",
    runtimeAgent: "cmo",
    isDevelopmentFallback: false,
    isRuntimeFallback: false,
    metadata: baseMetadata({
      requestId: request.request_id,
      responseStatus: response.status,
      fallbackUsed: false,
      sideEffects: response.side_effects,
      vaultContextUsage: response.vault_context_usage,
      contractWarnings: response.contract_warnings,
      stateContract: response.state_contract,
      artifactsOutCount: response.artifacts_out_count,
      artifactRefsCount: response.artifact_refs_count,
      decisionsCount: response.decisions_count,
      sessionSummaryUpdatePresent: response.suggested_session_summary_update !== undefined,
      suggestedVaultUpdatesCount: response.suggested_vault_updates_count,
    }),
    artifactsOut: response.artifacts_out,
    ...(response.suggested_session_summary_update !== undefined
      ? { suggestedSessionSummaryUpdate: response.suggested_session_summary_update }
      : {}),
    suggestedVaultUpdates: response.suggested_vault_updates,
  };
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`malformed_response:invalid_json:${compactText(text, 240)}`);
  }
}

async function httpFailureDetail(response: Response): Promise<{ reason: string; responseEnvelope: unknown }> {
  let detail = "";
  let responseEnvelope: unknown = null;

  try {
    const text = await response.text();
    const payload = text.trim() ? JSON.parse(text) as unknown : null;
    responseEnvelope = payload;
    detail = isRecord(payload) && typeof payload.error === "string" ? payload.error : compactText(JSON.stringify(payload), 240);
  } catch {
    detail = "";
  }

  return {
    reason: detail ? `http_${response.status}:${detail}` : `http_${response.status}`,
    responseEnvelope,
  };
}

export async function runHermesCmoChatV11(input: HermesCmoChatV11RequestInput): Promise<HermesCmoChatV11Run> {
  const request = buildHermesCmoChatV11Request(input);
  const baseUrl = getCmoHermesBaseUrl();
  const apiKey = getCmoHermesApiKey();

  await writeHermesCmoChatV11Trace(request, "request", {
    event: "request",
    request,
  });

  if (!baseUrl) {
    await writeHermesCmoChatV11Trace(request, "error", {
      event: "error",
      fallback_used: false,
      fallback_reason: "CMO_HERMES_BASE_URL is not configured.",
      fallback_eligible: false,
    });

    return { ok: false, request, fallbackEligible: false, fallbackReason: "CMO_HERMES_BASE_URL is not configured." };
  }

  if (!apiKey) {
    await writeHermesCmoChatV11Trace(request, "error", {
      event: "error",
      fallback_used: false,
      fallback_reason: "CMO_HERMES_API_KEY is not configured.",
      fallback_eligible: false,
    });

    return { ok: false, request, fallbackEligible: false, fallbackReason: "CMO_HERMES_API_KEY is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getCmoHermesTimeoutMs());

  try {
    const response = await fetch(`${baseUrl}${HERMES_CMO_CHAT_V11_ENDPOINT}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const failure = await httpFailureDetail(response);
      const fallbackEligible = response.status === 500;

      await writeHermesCmoChatV11Trace(request, "error", {
        event: "error",
        http_status: response.status,
        response: failure.responseEnvelope,
        fallback_used: false,
        fallback_reason: failure.reason,
        fallback_eligible: fallbackEligible,
        ...chatResponseTraceSummary(failure.responseEnvelope),
      });

      return {
        ok: false,
        request,
        fallbackEligible,
        fallbackReason: failure.reason,
      };
    }

    const payload = await parseJson(response);
    const normalized = normalizeHermesCmoChatV11Response(payload, request);

    await writeHermesCmoChatV11Trace(request, "response", {
      event: "response",
      response: payload,
      fallback_used: false,
      ...chatResponseTraceSummary(payload),
      ...(typeof normalized === "string" ? {} : {
        side_effects: normalized.side_effects,
        vault_context_usage: normalized.vault_context_usage,
        contract_warnings: normalized.contract_warnings,
        contract_warnings_count: normalized.contract_warnings_count,
        state_contract: normalized.state_contract,
        artifacts_out_count: normalized.artifacts_out_count,
        artifact_refs_count: normalized.artifact_refs_count,
        decisions_count: normalized.decisions_count,
        session_summary_update_present: normalized.suggested_session_summary_update !== undefined,
        suggested_vault_updates_count: normalized.suggested_vault_updates_count,
      }),
    });

    if (typeof normalized === "string") {
      const fallbackEligible = normalized === "missing_answer_content" || normalized.startsWith("malformed_response:");

      await writeHermesCmoChatV11Trace(request, "error", {
        event: "error",
        response: payload,
        fallback_used: false,
        fallback_reason: normalized,
        fallback_eligible: fallbackEligible,
        ...chatResponseTraceSummary(payload),
      });

      return {
        ok: false,
        request,
        fallbackEligible,
        fallbackReason: normalized,
      };
    }

    return {
      ok: true,
      request,
      response: normalized,
      metadata: baseMetadata({
        requestId: request.request_id,
        responseStatus: normalized.status,
        fallbackUsed: false,
        sideEffects: normalized.side_effects,
        vaultContextUsage: normalized.vault_context_usage,
        contractWarnings: normalized.contract_warnings,
        stateContract: normalized.state_contract,
        artifactsOutCount: normalized.artifacts_out_count,
        artifactRefsCount: normalized.artifact_refs_count,
        decisionsCount: normalized.decisions_count,
        sessionSummaryUpdatePresent: normalized.suggested_session_summary_update !== undefined,
        suggestedVaultUpdatesCount: normalized.suggested_vault_updates_count,
      }),
    };
  } catch (error) {
    const fallbackReason = error instanceof Error && error.name === "AbortError"
      ? "timeout"
      : error instanceof Error
        ? error.message
        : "Hermes CMO chat v1.1 request failed.";
    const fallbackEligible = fallbackReason === "timeout" || fallbackReason.startsWith("malformed_response:");

    await writeHermesCmoChatV11Trace(request, "error", {
      event: "error",
      fallback_used: false,
      fallback_reason: fallbackReason,
      fallback_eligible: fallbackEligible,
    });

    return {
      ok: false,
      request,
      fallbackEligible,
      fallbackReason,
    };
  } finally {
    clearTimeout(timeout);
  }
}
