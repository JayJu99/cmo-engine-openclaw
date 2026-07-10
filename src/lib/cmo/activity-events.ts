export const CMO_ACTIVITY_EVENT_SCHEMA_VERSION = "cmo.activity.event.v1" as const;

export type CmoActivityEventStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "timed_out"
  | "cancelled";

export type CmoActivitySourceAgent =
  | "cmo"
  | "product"
  | "hermes"
  | "surf"
  | "echo"
  | "lens"
  | "creative"
  | "vault";

export interface CmoActivityEventV1 {
  schema_version: typeof CMO_ACTIVITY_EVENT_SCHEMA_VERSION;
  event_id: string;
  seq: number;
  created_at: string;
  session_id?: string;
  turn_id?: string;
  request_id?: string;
  run_id?: string;
  chat_run_id?: string;
  source_agent: CmoActivitySourceAgent;
  type: string;
  status: CmoActivityEventStatus;
  title?: string;
  message?: string;
  user_visible: boolean;
  safe_metadata?: Record<string, unknown>;
}

export interface NormalizeCmoActivityEventContext {
  sessionId?: string;
  turnId?: string;
  requestId?: string;
  runId?: string;
  chatRunId?: string;
  createdAt?: string;
  startSeq?: number;
}

export interface ProductChatRunLifecycleEventInput extends NormalizeCmoActivityEventContext {
  status: CmoActivityEventStatus;
  seq?: number;
  title?: string;
  message?: string;
  safeMetadata?: Record<string, unknown>;
}

type ActivityEventRecord = Record<string, unknown>;

const DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";
const MAX_EVENTS = 120;
const MAX_SAFE_METADATA_KEYS = 20;
const MAX_SAFE_METADATA_STRING_CHARS = 240;
const MAX_SAFE_METADATA_JSON_CHARS = 4_000;
const UNSAFE_ACTIVITY_TEXT_PATTERN =
  /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|file:|\/(?:tmp|Users|home|var|mnt|Volumes)(?:\/|\b)|\/private(?:\/|\b)|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|conversion_h_|creative-agent-images|cmo-creative-execute|creative[_\s-]*image[_\s-]*asset[_\s-]*refine|\.(?:png_redact|png|jpe?g|webp|mp4|webm)(?:\b|_|$)|(?:raw[_-]?artifact[_-]?payload|rawArtifactPayload|raw[_-]?contract[_-]?json|rawContractJson|local[_-]?path|localPath|source[_-]?local[_-]?path|sourceLocalPath)|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/i;
const BLOCKED_SAFE_METADATA_KEYS = new Set([
  "raw",
  "payload",
  "body",
  "content",
  "answer",
  "text",
  "source_text",
  "excerpt",
  "full_text",
  "api_key",
  "token",
  "secret",
  "authorization",
  "headers",
  "cookie",
  "file_path",
  "local_path",
  "prompt",
  "system_prompt",
  "user_prompt",
]);

function isRecord(value: unknown): value is ActivityEventRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, maxChars = 0): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return maxChars > 0 && trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function safeActivityText(value: unknown, maxChars: number): string | undefined {
  const text = stringValue(value);

  if (!text) {
    return undefined;
  }

  const safeLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !UNSAFE_ACTIVITY_TEXT_PATTERN.test(line));
  const safe = safeLines.join("\n").trim();

  if (!safe) {
    return undefined;
  }

  return safe.length > maxChars ? safe.slice(0, maxChars) : safe;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);

  return normalized > 0 ? normalized : undefined;
}

function keyTokenize(key: string): string[] {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.split("_").filter(Boolean);
}

function normalizedKey(key: string): string {
  return keyTokenize(key).join("_");
}

function isBlockedSafeMetadataKey(key: string): boolean {
  const normalized = normalizedKey(key);
  const tokens = keyTokenize(key);

  return BLOCKED_SAFE_METADATA_KEYS.has(normalized) ||
    tokens.some((token) => BLOCKED_SAFE_METADATA_KEYS.has(token));
}

function sanitizeSafeMetadataValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return safeActivityText(value, MAX_SAFE_METADATA_STRING_CHARS);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, 20)
      .map((item) => sanitizeSafeMetadataValue(item, depth + 1))
      .filter((item) => item !== undefined);

    return sanitized.length ? sanitized : undefined;
  }

  if (isRecord(value) && depth < 2) {
    return sanitizeSafeMetadataRecord(value, depth + 1);
  }

  return undefined;
}

export function sanitizeSafeMetadataRecord(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    if (Object.keys(sanitized).length >= MAX_SAFE_METADATA_KEYS || isBlockedSafeMetadataKey(key)) {
      continue;
    }

    const safeKey = normalizedKey(key);

    if (!safeKey || isBlockedSafeMetadataKey(safeKey)) {
      continue;
    }

    const safeValue = sanitizeSafeMetadataValue(rawValue, depth);

    if (safeValue === undefined) {
      continue;
    }

    sanitized[safeKey] = safeValue;

    while (JSON.stringify(sanitized).length > MAX_SAFE_METADATA_JSON_CHARS) {
      const lastKey = Object.keys(sanitized).at(-1);

      if (!lastKey) {
        break;
      }

      delete sanitized[lastKey];
    }
  }

  return Object.keys(sanitized).length ? sanitized : undefined;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceFromMode(value: unknown): CmoActivitySourceAgent | undefined {
  const mode = metadataString(value);

  if (!mode) {
    return undefined;
  }

  return normalizeCmoActivitySourceAgent(mode.split(".")[0], undefined);
}

function sourceFromType(value: unknown): CmoActivitySourceAgent | undefined {
  const type = metadataString(value);

  if (!type) {
    return undefined;
  }

  return normalizeCmoActivitySourceAgent(type.split(".")[0], undefined);
}

export function normalizeCmoActivitySourceAgent(
  value: unknown,
  fallback: CmoActivitySourceAgent | undefined = "cmo",
): CmoActivitySourceAgent | undefined {
  const raw = metadataString(value);

  if (!raw) {
    return fallback;
  }

  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  if (normalized === "cmo") return "cmo";
  if (normalized === "product") return "product";
  if (normalized === "hermes") return "hermes";
  if (normalized === "surf") return "surf";
  if (normalized === "echo") return "echo";
  if (normalized === "lens") return "lens";
  if (normalized === "creative") return "creative";
  if (normalized === "vault" || normalized === "vault_agent") return "vault";

  return fallback;
}

export function normalizeCmoActivityEventStatus(
  value: unknown,
  fallback: CmoActivityEventStatus = "completed",
): CmoActivityEventStatus {
  const normalized = metadataString(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  if (!normalized) {
    return fallback;
  }

  if (normalized === "queued" || normalized === "pending") return "queued";
  if (normalized === "running" || normalized === "started" || normalized === "in_progress" || normalized === "waiting") return "running";
  if (normalized === "completed" || normalized === "complete" || normalized === "success" || normalized === "succeeded") return "completed";
  if (normalized === "skipped" || normalized === "skip" || normalized === "not_run") return "skipped";
  if (normalized === "failed" || normalized === "failure" || normalized === "error") return "failed";
  if (normalized === "timed_out" || normalized === "timeout" || normalized === "timedout") return "timed_out";
  if (normalized === "cancelled" || normalized === "canceled" || normalized === "interrupted") return "cancelled";

  return fallback;
}

function idPart(value: string | undefined, fallback: string): string {
  return (value ?? fallback)
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function fallbackEventId(input: {
  sessionId?: string;
  turnId?: string;
  seq: number;
  type: string;
  sourceAgent: string;
}): string {
  return [
    "evt",
    idPart(input.sessionId, "session"),
    idPart(input.turnId, "turn"),
    String(input.seq),
    idPart(input.type, "event"),
    idPart(input.sourceAgent, "cmo"),
  ].join("_");
}

function eventSourceMode(event: ActivityEventRecord): string | undefined {
  const source = isRecord(event.source) ? event.source : {};

  return stringValue(event.source_mode ?? event.sourceMode ?? source.mode, MAX_SAFE_METADATA_STRING_CHARS);
}

function buildSafeMetadata(event: ActivityEventRecord): Record<string, unknown> | undefined {
  const source = isRecord(event.source) ? event.source : {};
  const explicitMetadata = sanitizeSafeMetadataRecord(event.safe_metadata ?? event.safeMetadata);
  const whitelisted: Record<string, unknown> = {};
  const sourceMode = eventSourceMode(event);
  const delegationId = stringValue(event.delegation_id ?? event.delegationId ?? explicitMetadata?.delegation_id, MAX_SAFE_METADATA_STRING_CHARS);
  const targetAgent = stringValue(event.target_agent ?? event.targetAgent, MAX_SAFE_METADATA_STRING_CHARS);
  const mode = stringValue(event.mode ?? source.mode, MAX_SAFE_METADATA_STRING_CHARS);
  const originalStatus = stringValue(event.status, MAX_SAFE_METADATA_STRING_CHARS);

  if (sourceMode) {
    whitelisted.source_mode = sourceMode;
  }

  if (delegationId) {
    whitelisted.delegation_id = delegationId;
  }

  if (targetAgent) {
    whitelisted.target_agent = targetAgent;
  }

  if (mode) {
    whitelisted.mode = mode;
  }

  if (originalStatus === "interrupted") {
    whitelisted.original_status = "interrupted";
  }

  for (const [key, value] of Object.entries(explicitMetadata ?? {})) {
    if (!(key in whitelisted)) {
      whitelisted[key] = value;
    }
  }

  return sanitizeSafeMetadataRecord(whitelisted);
}

export function normalizeCmoActivityEvent(
  value: unknown,
  index: number,
  context: NormalizeCmoActivityEventContext = {},
): CmoActivityEventV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = stringValue(value.type, 160);

  if (!type) {
    return null;
  }

  const source = isRecord(value.source) ? value.source : {};
  const sourceAgent = normalizeCmoActivitySourceAgent(
    value.source_agent ?? value.sourceAgent ?? source.agent,
    sourceFromMode(value.sourceMode ?? value.source_mode ?? source.mode) ?? sourceFromType(type) ?? "cmo",
  ) ?? "cmo";
  const seq = positiveInteger(value.seq) ?? Math.max(1, Math.floor(context.startSeq ?? 1) + index);
  const sessionId = stringValue(value.session_id ?? value.sessionId ?? context.sessionId, 180);
  const turnId = stringValue(value.turn_id ?? value.turnId ?? context.turnId, 180);
  const requestId = stringValue(value.request_id ?? value.requestId ?? context.requestId, 180);
  const runId = stringValue(value.run_id ?? value.runId ?? context.runId, 180);
  const chatRunId = stringValue(value.chat_run_id ?? value.chatRunId ?? context.chatRunId, 180);
  const eventId = stringValue(value.event_id ?? value.eventId, 220) ?? fallbackEventId({
    sessionId,
    turnId,
    seq,
    type,
    sourceAgent,
  });
  const createdAt = stringValue(value.created_at ?? value.createdAt ?? context.createdAt, 80) ?? DEFAULT_CREATED_AT;
  const title = safeActivityText(value.title, 180);
  const message = safeActivityText(value.message, 1_000);
  const safeMetadata = buildSafeMetadata(value);

  return {
    schema_version: CMO_ACTIVITY_EVENT_SCHEMA_VERSION,
    event_id: eventId,
    seq,
    created_at: createdAt,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(turnId ? { turn_id: turnId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(runId ? { run_id: runId } : {}),
    ...(chatRunId ? { chat_run_id: chatRunId } : {}),
    source_agent: sourceAgent,
    type,
    status: normalizeCmoActivityEventStatus(value.status),
    ...(title ? { title } : {}),
    ...(message ? { message } : {}),
    user_visible: value.user_visible === true || value.userVisible === true,
    ...(safeMetadata ? { safe_metadata: safeMetadata } : {}),
  };
}

export function normalizeCmoActivityEvents(
  value: unknown,
  context: NormalizeCmoActivityEventContext = {},
): CmoActivityEventV1[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_EVENTS)
    .map((event, index) => normalizeCmoActivityEvent(event, index, context))
    .filter((event): event is CmoActivityEventV1 => Boolean(event));
}

export function createProductChatRunLifecycleEvent(input: ProductChatRunLifecycleEventInput): CmoActivityEventV1 {
  const status = normalizeCmoActivityEventStatus(input.status);
  const type = `product.chat_run.${status}`;
  const seq = Math.max(1, Math.floor(input.seq ?? input.startSeq ?? 1));
  const title = safeActivityText(input.title, 180);
  const message = safeActivityText(input.message, 1_000);

  return {
    schema_version: CMO_ACTIVITY_EVENT_SCHEMA_VERSION,
    event_id: fallbackEventId({
      sessionId: input.sessionId,
      turnId: input.turnId,
      seq,
      type,
      sourceAgent: "product",
    }),
    seq,
    created_at: input.createdAt ?? DEFAULT_CREATED_AT,
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
    ...(input.turnId ? { turn_id: input.turnId } : {}),
    ...(input.requestId ? { request_id: input.requestId } : {}),
    ...(input.runId ? { run_id: input.runId } : {}),
    ...(input.chatRunId ? { chat_run_id: input.chatRunId } : {}),
    source_agent: "product",
    type,
    status,
    ...(title ? { title } : {}),
    ...(message ? { message } : {}),
    user_visible: true,
    ...(input.safeMetadata ? { safe_metadata: sanitizeSafeMetadataRecord(input.safeMetadata) } : {}),
  };
}

export function mergeCmoActivityEvents(
  existing: unknown,
  additions: unknown,
  context: NormalizeCmoActivityEventContext = {},
): CmoActivityEventV1[] {
  const normalized = [
    ...normalizeCmoActivityEvents(existing, context),
    ...normalizeCmoActivityEvents(additions, context),
  ];
  const seen = new Set<string>();
  const merged: CmoActivityEventV1[] = [];

  for (const event of normalized) {
    if (seen.has(event.event_id)) {
      continue;
    }

    seen.add(event.event_id);
    merged.push(event);
  }

  return merged;
}

export function cmoActivityEventId(event: unknown): string {
  if (!isRecord(event)) {
    return "";
  }

  return stringValue(event.event_id ?? event.eventId, 220) ?? "";
}

export function cmoActivityEventType(event: unknown): string {
  if (!isRecord(event)) {
    return "";
  }

  return stringValue(event.type, 160) ?? "";
}

export function cmoActivityEventTitle(event: unknown): string {
  if (!isRecord(event)) {
    return "";
  }

  return stringValue(event.title, 180) ?? "";
}

export function cmoActivityEventMessage(event: unknown): string {
  if (!isRecord(event)) {
    return "";
  }

  return stringValue(event.message, 1_000) ?? "";
}

export function cmoActivityEventStatus(event: unknown): CmoActivityEventStatus {
  if (!isRecord(event)) {
    return "completed";
  }

  return normalizeCmoActivityEventStatus(event.status);
}

export function cmoActivityEventUserVisible(event: unknown): boolean {
  if (!isRecord(event)) {
    return false;
  }

  return event.user_visible === true || event.userVisible === true;
}

export function cmoActivityEventSourceAgent(event: unknown): CmoActivitySourceAgent | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const source = isRecord(event.source) ? event.source : {};

  return normalizeCmoActivitySourceAgent(
    event.source_agent ?? event.sourceAgent ?? source.agent,
    sourceFromMode(event.sourceMode ?? event.source_mode ?? source.mode) ?? sourceFromType(event.type) ?? undefined,
  );
}

export function cmoActivityEventSourceMode(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const safeMetadata = isRecord(event.safe_metadata) ? event.safe_metadata : {};

  return stringValue(safeMetadata.source_mode ?? event.sourceMode ?? event.source_mode, MAX_SAFE_METADATA_STRING_CHARS);
}

export function cmoActivityEventDelegationId(event: unknown): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const safeMetadata = isRecord(event.safe_metadata) ? event.safe_metadata : {};

  return stringValue(
    safeMetadata.delegation_id ?? event.delegation_id ?? event.delegationId,
    MAX_SAFE_METADATA_STRING_CHARS,
  );
}
