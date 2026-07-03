const OUTBOUND_FORBIDDEN_TEXT_PATTERN =
  /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|file:|\/(?:tmp|Users|home|var|mnt|Volumes)\/|\/private(?:\/|\b)|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|conversion_h_|creative-agent-images|cmo-creative-execute|creative[_\s-]*image[_\s-]*asset[_\s-]*refine|\.(?:png_redact|png|jpe?g|webp|mp4|webm)(?:\b|_|$)|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/i;
export const OUTBOUND_HERMES_CALLSITE_GUARD_VERSION = "context-sanitizer-v2" as const;
const OUTBOUND_CALLSITE_FORBIDDEN_LITERALS = [
  { literal: "[hermes_local_artifact_path_redacted]", label: "hermes_local_artifact_path_redacted" },
  { literal: "hermes_local_artifact_path_redacted", label: "hermes_local_artifact_path_redacted" },
  { literal: ".png_redact", label: ".png_redact" },
  { literal: "/tmp/", label: "/tmp/" },
  { literal: "/Users/", label: "/Users/" },
  { literal: "/home/", label: "/home/" },
  { literal: "/var/", label: "/var/" },
  { literal: "/mnt/", label: "/mnt/" },
  { literal: "/private", label: "/private" },
  { literal: "/Volumes/", label: "/Volumes/" },
  { literal: "file:", label: "file:" },
  { literal: "conversion_h_", label: "conversion_h_" },
  { literal: "creative-agent-images", label: "creative-agent-images" },
  { literal: "cmo-creative-execute", label: "cmo-creative-execute" },
  { literal: "Creative_image_asset_Refine", label: "Creative_image_asset_Refine" },
] as const;

const TEXT_PLACEHOLDER =
  "Creative artifact text was redacted by Product before sending this turn to Hermes. Use canonical chat text and Product reference asset metadata for context.";
const ASSISTANT_PLACEHOLDER =
  "Creative asset was generated or updated. Use active asset metadata and reference_assets for visual context.";
const USER_PLACEHOLDER =
  "User message included an internal artifact reference that Product redacted before sending this turn to Hermes.";
const TRACE_CONTENT_PLACEHOLDER =
  "Trace content omitted by Product outbound trace projection.";

const URL_FIELD_NAMES = new Set([
  "preview_url",
  "render_url",
  "signed_url",
  "previewUrl",
  "renderUrl",
  "signedUrl",
]);

const MAX_FIELD_PREVIEW_COUNT = 48;
const MAX_CALLSITE_SNIPPETS = 5;
const MAX_CALLSITE_PATHS = 20;

type JsonPathSegment = string | number;
type OutboundCallsiteBlockSource = "fetch_body" | "trace_envelope";

export interface OutboundHermesPayloadSanitizerDiagnostics {
  outbound_hermes_payload_sanitized: boolean;
  outbound_hermes_payload_path_like_blocked: boolean;
  outbound_sanitized_field_count: number;
  outbound_sanitized_fields_preview: string[];
  outbound_callsite_guard_version?: typeof OUTBOUND_HERMES_CALLSITE_GUARD_VERSION;
  outbound_callsite_guard_checked?: boolean;
  outbound_callsite_guard_blocked?: boolean;
  workspace_fallback_suppressed_for_creative?: true;
  outbound_callsite_blocked_literals?: string[];
  outbound_callsite_blocked_sources?: OutboundCallsiteBlockSource[];
  outbound_callsite_blocked_snippets?: string[];
  outbound_callsite_blocked_paths?: string[];
  outbound_trace_projection_applied?: boolean;
  outbound_trace_replaced_field_count?: number;
  outbound_trace_replaced_fields_preview?: string[];
}

export interface OutboundHermesPayloadSanitizerResult<T> {
  payload: T;
  diagnostics: OutboundHermesPayloadSanitizerDiagnostics;
  blockedFieldsPreview: string[];
}

export interface OutboundHermesTraceSafeProjectionResult<T> {
  payload: T;
  diagnostics: {
    outbound_trace_projection_applied: boolean;
    outbound_trace_replaced_field_count: number;
    outbound_trace_replaced_fields_preview: string[];
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const outboundHermesStringHasForbiddenArtifactText = (value: string): boolean =>
  OUTBOUND_FORBIDDEN_TEXT_PATTERN.test(value);

export const outboundHermesCallsiteBlockedLiteralLabels = (outboundPayloadJson: string): string[] =>
  OUTBOUND_CALLSITE_FORBIDDEN_LITERALS
    .flatMap(({ literal, label }) => outboundPayloadJson.includes(literal) ? [label] : []);

export interface OutboundHermesCallsiteBlockInspection {
  literals: string[];
  sources: OutboundCallsiteBlockSource[];
  snippets: string[];
  paths: string[];
}

const fieldPathPreview = (path: JsonPathSegment[]): string => {
  const preview = path.map((segment) => {
    if (segment === "reference_assets") {
      return "refAssets";
    }

    if (segment === "referenceAssets") {
      return "refAssetsCamel";
    }

    if (typeof segment === "number") {
      return String(segment);
    }

    return outboundHermesStringHasForbiddenArtifactText(segment)
      ? "redacted_creative_artifact_key"
      : segment;
  }).join(".");

  return preview.slice(0, 180);
};

const uniqueLimited = (values: string[], limit: number): string[] =>
  Array.from(new Set(values)).slice(0, limit);

const literalEntriesForString = (value: string): Array<{ literal: string; label: string }> =>
  OUTBOUND_CALLSITE_FORBIDDEN_LITERALS.filter(({ literal }) => value.includes(literal));

export const OUTBOUND_HERMES_LOCAL_PATH_REDACTION = "[local_path_redacted]" as const;

export function sanitizeOutboundHermesContextText(value: string): string {
  return value
    .replace(/\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted/gi, OUTBOUND_HERMES_LOCAL_PATH_REDACTION)
    .replace(/file:[^\s"',})\]]+/gi, OUTBOUND_HERMES_LOCAL_PATH_REDACTION)
    .replace(/[A-Za-z]:[\\/][^\s"',})\]]+/g, OUTBOUND_HERMES_LOCAL_PATH_REDACTION)
    .replace(/\/(?:tmp|Users|home|var|mnt|private|Volumes)\/[^\r\n"',})\]]*/g, OUTBOUND_HERMES_LOCAL_PATH_REDACTION)
    .replace(/\.png_redact\b/gi, OUTBOUND_HERMES_LOCAL_PATH_REDACTION)
    .replace(/\b(?:creative-agent-images|cmo-creative-execute|conversion_h_|Creative_image_asset_Refine)\b/gi, OUTBOUND_HERMES_LOCAL_PATH_REDACTION);
}

const sanitizedSnippetAroundLiteral = (value: string, literal: string): string => {
  const index = value.indexOf(literal);
  if (index < 0) {
    return "";
  }

  const start = Math.max(0, index - 32);
  const end = Math.min(value.length, index + literal.length + 32);
  const snippet = value.slice(start, end)
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z]:[\\/][^"',\s}]+/g, OUTBOUND_HERMES_LOCAL_PATH_REDACTION)
    .replace(/file:[^"',\s}]+/gi, OUTBOUND_HERMES_LOCAL_PATH_REDACTION)
    .replace(/\/(?:tmp|Users|home|var|mnt|private|Volumes)\/[^"',\s}]+/g, OUTBOUND_HERMES_LOCAL_PATH_REDACTION);

  return `${start > 0 ? "..." : ""}${snippet}${end < value.length ? "..." : ""}`.slice(0, 240);
};

const collectCallsiteBlockedStringFields = (
  value: unknown,
  path: JsonPathSegment[],
  result: { literals: string[]; snippets: string[]; paths: string[] },
): void => {
  if (typeof value === "string") {
    const matches = literalEntriesForString(value);
    if (!matches.length) {
      return;
    }

    result.paths.push(fieldPathPreview(path));
    for (const match of matches) {
      result.literals.push(match.label);
      if (result.snippets.length < MAX_CALLSITE_SNIPPETS) {
        const snippet = sanitizedSnippetAroundLiteral(value, match.literal);
        if (snippet) {
          result.snippets.push(snippet);
        }
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCallsiteBlockedStringFields(item, [...path, index], result));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  Object.entries(value).forEach(([key, item]) => {
    const keyMatches = literalEntriesForString(key);
    if (keyMatches.length) {
      result.paths.push(fieldPathPreview([...path, key]));
      for (const match of keyMatches) {
        result.literals.push(match.label);
        if (result.snippets.length < MAX_CALLSITE_SNIPPETS) {
          const snippet = sanitizedSnippetAroundLiteral(key, match.literal);
          if (snippet) {
            result.snippets.push(snippet);
          }
        }
      }
    }
    collectCallsiteBlockedStringFields(item, [...path, key], result);
  });
};

export const inspectOutboundHermesCallsiteBlock = (
  source: OutboundCallsiteBlockSource,
  value: unknown,
): OutboundHermesCallsiteBlockInspection => {
  const result: { literals: string[]; snippets: string[]; paths: string[] } = {
    literals: [],
    snippets: [],
    paths: [],
  };

  if (typeof value === "string") {
    for (const match of literalEntriesForString(value)) {
      result.literals.push(match.label);
      if (result.snippets.length < MAX_CALLSITE_SNIPPETS) {
        const snippet = sanitizedSnippetAroundLiteral(value, match.literal);
        if (snippet) {
          result.snippets.push(snippet);
        }
      }
    }
  } else {
    collectCallsiteBlockedStringFields(value, [], result);
  }

  return {
    literals: uniqueLimited(result.literals, OUTBOUND_CALLSITE_FORBIDDEN_LITERALS.length),
    sources: result.literals.length ? [source] : [],
    snippets: uniqueLimited(result.snippets, MAX_CALLSITE_SNIPPETS),
    paths: uniqueLimited(result.paths, MAX_CALLSITE_PATHS),
  };
};

export const mergeOutboundHermesCallsiteBlockInspections = (
  inspections: OutboundHermesCallsiteBlockInspection[],
): OutboundHermesCallsiteBlockInspection => ({
  literals: uniqueLimited(inspections.flatMap((inspection) => inspection.literals), OUTBOUND_CALLSITE_FORBIDDEN_LITERALS.length),
  sources: Array.from(new Set(inspections.flatMap((inspection) => inspection.sources))),
  snippets: uniqueLimited(inspections.flatMap((inspection) => inspection.snippets), MAX_CALLSITE_SNIPPETS),
  paths: uniqueLimited(inspections.flatMap((inspection) => inspection.paths), MAX_CALLSITE_PATHS),
});

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const replaceTraceStringField = (
  record: Record<string, unknown>,
  key: string,
  path: JsonPathSegment[],
  replacedFields: string[],
  shouldReplace: (value: string) => boolean = () => true,
): void => {
  const value = record[key];
  if (typeof value !== "string" || !shouldReplace(value)) {
    return;
  }

  record[key] = TRACE_CONTENT_PLACEHOLDER;
  replacedFields.push(fieldPathPreview(path));
};

const replaceTraceArrayFields = (
  value: unknown,
  path: JsonPathSegment[],
  fields: string[],
  replacedFields: string[],
): void => {
  if (!Array.isArray(value)) {
    return;
  }

  value.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }

    for (const field of fields) {
      replaceTraceStringField(item, field, [...path, index, field], replacedFields);
    }
  });
};

const replaceTraceContextFields = (
  contextPack: unknown,
  path: JsonPathSegment[],
  replacedFields: string[],
): void => {
  if (!isRecord(contextPack)) {
    return;
  }

  replaceTraceArrayFields(contextPack.selected_context, [...path, "selected_context"], ["content", "full_content"], replacedFields);
  replaceTraceStringField(contextPack, "recent_session_summary", [...path, "recent_session_summary"], replacedFields);
  replaceTraceArrayFields(contextPack.all_context_items, [...path, "all_context_items"], ["content", "contentPreview"], replacedFields);
  replaceTraceArrayFields(contextPack.missing_context, [...path, "missing_context"], ["contentPreview"], replacedFields);
  replaceTraceArrayFields(contextPack.context_used, [...path, "context_used"], ["contentPreview"], replacedFields);
};

const replaceTraceMessageFields = (
  messages: unknown,
  path: JsonPathSegment[],
  replacedFields: string[],
): void => {
  if (!Array.isArray(messages)) {
    return;
  }

  messages.forEach((message, index) => {
    if (!isRecord(message) || message.role !== "assistant") {
      return;
    }

    replaceTraceStringField(
      message,
      "content",
      [...path, index, "content"],
      replacedFields,
      (value) => value === ASSISTANT_PLACEHOLDER,
    );
  });
};

export const buildOutboundHermesTraceSafeRequest = <T>(payload: T): OutboundHermesTraceSafeProjectionResult<T> => {
  if (!isRecord(payload)) {
    return {
      payload,
      diagnostics: {
        outbound_trace_projection_applied: false,
        outbound_trace_replaced_field_count: 0,
        outbound_trace_replaced_fields_preview: [],
      },
    };
  }

  let projectedPayload = jsonClone(payload) as T;
  const replacedFields: string[] = [];

  if (isRecord(projectedPayload)) {
    replaceTraceContextFields(projectedPayload.context_pack, ["context_pack"], replacedFields);
    replaceTraceMessageFields(projectedPayload.messages, ["messages"], replacedFields);
  }

  const recursivelySanitizedFields: string[] = [];
  projectedPayload = sanitizeValue(projectedPayload, [], undefined, recursivelySanitizedFields) as T;
  replacedFields.push(...recursivelySanitizedFields);

  const uniqueReplacedFields = uniqueLimited(replacedFields, MAX_FIELD_PREVIEW_COUNT);

  return {
    payload: projectedPayload,
    diagnostics: {
      outbound_trace_projection_applied: uniqueReplacedFields.length > 0,
      outbound_trace_replaced_field_count: Array.from(new Set(replacedFields)).length,
      outbound_trace_replaced_fields_preview: uniqueReplacedFields,
    },
  };
};

const recordRole = (record: Record<string, unknown>): string | null =>
  typeof record.role === "string" ? record.role : null;

const safeReplacementForString = (key: string | undefined, parent: Record<string, unknown> | undefined): string | null => {
  if (key && URL_FIELD_NAMES.has(key)) {
    return null;
  }

  const role = parent ? recordRole(parent) : null;

  if (role === "assistant" && (key === "content" || key === "full_content" || key === "body" || key === "message")) {
    return ASSISTANT_PLACEHOLDER;
  }

  if (role === "user" && (key === "content" || key === "full_content" || key === "body" || key === "message")) {
    return USER_PLACEHOLDER;
  }

  return TEXT_PLACEHOLDER;
};

const safeReplacementForKey = (key: string): string =>
  outboundHermesStringHasForbiddenArtifactText(key)
    ? "redacted_creative_artifact_key"
    : key;

function sanitizeValue(
  value: unknown,
  path: JsonPathSegment[],
  parent: Record<string, unknown> | undefined,
  sanitizedFields: string[],
): unknown {
  if (typeof value === "string") {
    const sanitizedContextText = sanitizeOutboundHermesContextText(value);
    if (sanitizedContextText !== value) {
      sanitizedFields.push(fieldPathPreview(path));
      return sanitizedContextText;
    }

    if (!outboundHermesStringHasForbiddenArtifactText(sanitizedContextText)) {
      return value;
    }

    sanitizedFields.push(fieldPathPreview(path));
    const key = typeof path.at(-1) === "string" ? path.at(-1) as string : undefined;
    return safeReplacementForString(key, parent);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, [...path, index], undefined, sanitizedFields));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const safeKey = safeReplacementForKey(key);
      if (safeKey !== key) {
        sanitizedFields.push(fieldPathPreview([...path, key]));
      }

      return [
        safeKey,
        sanitizeValue(item, [...path, safeKey], value, sanitizedFields),
      ];
    }),
  );
}

const collectBlockedFields = (value: unknown, path: JsonPathSegment[] = [], blockedFields: string[] = []): string[] => {
  if (typeof value === "string") {
    if (outboundHermesStringHasForbiddenArtifactText(value)) {
      blockedFields.push(fieldPathPreview(path));
    }

    return blockedFields;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectBlockedFields(item, [...path, index], blockedFields));
    return blockedFields;
  }

  if (!isRecord(value)) {
    return blockedFields;
  }

  Object.entries(value).forEach(([key, item]) => collectBlockedFields(item, [...path, key], blockedFields));
  return blockedFields;
};

const addDiagnostics = <T>(payload: T, diagnostics: OutboundHermesPayloadSanitizerDiagnostics): T => {
  if (!isRecord(payload)) {
    return payload;
  }

  const next: Record<string, unknown> = {
    ...payload,
    outbound_hermes_payload_guard: diagnostics,
  };

  if (isRecord(next.input)) {
    next.input = {
      ...next.input,
      outbound_hermes_payload_guard: diagnostics,
    };
  }

  if (isRecord(next.constraints)) {
    next.constraints = {
      ...next.constraints,
      ...diagnostics,
      outbound_hermes_payload_guard: diagnostics,
    };
  }

  if (isRecord(next.options)) {
    next.options = {
      ...next.options,
      outbound_hermes_payload_guard: diagnostics,
    };
  }

  return next as T;
};

export const withOutboundHermesPayloadGuardDiagnostics = <T>(
  payload: T,
  diagnostics: OutboundHermesPayloadSanitizerDiagnostics,
): T => addDiagnostics(payload, diagnostics);

export function sanitizeOutboundHermesPayload<T>(
  payload: T,
  options: { creativeRoute?: boolean } = {},
): OutboundHermesPayloadSanitizerResult<T> {
  const sanitizedFields: string[] = [];
  const sanitizedPayload = sanitizeValue(payload, [], undefined, sanitizedFields) as T;
  const uniqueSanitizedFields = Array.from(new Set(sanitizedFields));
  const provisionalDiagnostics: OutboundHermesPayloadSanitizerDiagnostics = {
    outbound_hermes_payload_sanitized: uniqueSanitizedFields.length > 0,
    outbound_hermes_payload_path_like_blocked: false,
    outbound_sanitized_field_count: uniqueSanitizedFields.length,
    outbound_sanitized_fields_preview: uniqueSanitizedFields.slice(0, MAX_FIELD_PREVIEW_COUNT),
    ...(options.creativeRoute ? { workspace_fallback_suppressed_for_creative: true } : {}),
  };
  const provisionalPayload = addDiagnostics(sanitizedPayload, provisionalDiagnostics);
  const blockedFields = collectBlockedFields(provisionalPayload);
  const serializedPayloadBlocked = outboundHermesStringHasForbiddenArtifactText(JSON.stringify(provisionalPayload));
  const diagnostics: OutboundHermesPayloadSanitizerDiagnostics = {
    ...provisionalDiagnostics,
    outbound_hermes_payload_path_like_blocked: blockedFields.length > 0 || serializedPayloadBlocked,
  };

  return {
    payload: addDiagnostics(sanitizedPayload, diagnostics),
    diagnostics,
    blockedFieldsPreview: Array.from(new Set(blockedFields)).slice(0, MAX_FIELD_PREVIEW_COUNT),
  };
}
