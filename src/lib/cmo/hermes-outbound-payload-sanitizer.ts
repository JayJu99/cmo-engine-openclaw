export const OUTBOUND_HERMES_CALLSITE_GUARD_VERSION = "context-sanitizer-v2" as const;

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

export const OUTBOUND_HERMES_LOCAL_PATH_REDACTION = "[local_path_redacted]" as const;
export const OUTBOUND_HERMES_FILE_URI_REDACTION = "[file_uri_redacted]" as const;
export const OUTBOUND_HERMES_ARTIFACT_TEXT_REDACTION = "[artifact_text_redacted]" as const;
export const OUTBOUND_HERMES_SECRET_REDACTION = "[secret_redacted]" as const;
const SAFE_OUTBOUND_REDACTION_TOKEN_PATTERN =
  /\[(?:local_path|file_uri|artifact_text|secret)_redacted\]/gi;

type JsonPathSegment = string | number;
type OutboundCallsiteBlockSource = "fetch_body" | "trace_envelope";
export type OutboundHermesBlockedClass =
  | "local_path"
  | "home_path"
  | "absolute_path"
  | "file_uri"
  | "artifact_text"
  | "secret_like"
  | "raw_artifact"
  | "serialized_payload_string_match";

interface OutboundHermesUnsafeTextRule {
  class: Exclude<OutboundHermesBlockedClass, "serialized_payload_string_match">;
  label: string;
  redactionToken: string;
  pattern: RegExp;
}

export interface OutboundHermesForbiddenMatch {
  class: Exclude<OutboundHermesBlockedClass, "serialized_payload_string_match">;
  label: string;
  redactionToken: string;
}

const OUTBOUND_HERMES_UNSAFE_TEXT_RULES: readonly OutboundHermesUnsafeTextRule[] = [
  { class: "artifact_text", label: "artifact_path_marker", redactionToken: OUTBOUND_HERMES_ARTIFACT_TEXT_REDACTION, pattern: /\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted/gi },
  { class: "file_uri", label: "file_uri", redactionToken: OUTBOUND_HERMES_FILE_URI_REDACTION, pattern: /file:[^\s"',})\]]+/gi },
  { class: "home_path", label: "home_path", redactionToken: OUTBOUND_HERMES_LOCAL_PATH_REDACTION, pattern: /\/home\/[^\r\n"',})\]]*/gi },
  { class: "local_path", label: "local_path_root", redactionToken: OUTBOUND_HERMES_LOCAL_PATH_REDACTION, pattern: /\/(?:tmp|Users|var|mnt|Volumes)\/[^\r\n"',})\]]*/gi },
  { class: "local_path", label: "private_path", redactionToken: OUTBOUND_HERMES_LOCAL_PATH_REDACTION, pattern: /\/private(?:\/[^\r\n"',})\]]*)?/gi },
  { class: "absolute_path", label: "windows_absolute_path", redactionToken: OUTBOUND_HERMES_LOCAL_PATH_REDACTION, pattern: /[A-Za-z]:[\\/][^\s"',})\]]+/g },
  { class: "artifact_text", label: "artifact_extension", redactionToken: OUTBOUND_HERMES_ARTIFACT_TEXT_REDACTION, pattern: /\.(?:png_redact|png|jpe?g|webp|mp4|webm)(?:\b|_|$)/gi },
  { class: "artifact_text", label: "artifact_runtime_label", redactionToken: OUTBOUND_HERMES_ARTIFACT_TEXT_REDACTION, pattern: /(?:creative-agent-images|cmo-creative-execute|conversion_h_|Creative[_\s-]*image[_\s-]*asset[_\s-]*Refine)/gi },
  { class: "raw_artifact", label: "raw_artifact", redactionToken: OUTBOUND_HERMES_ARTIFACT_TEXT_REDACTION, pattern: /\b(?:raw[_-]?artifact[_-]?payload|rawArtifactPayload|raw[_-]?contract[_-]?json|rawContractJson)\b/gi },
  { class: "local_path", label: "local_path", redactionToken: OUTBOUND_HERMES_LOCAL_PATH_REDACTION, pattern: /\b(?:source[_-]?local[_-]?path|sourceLocalPath|local[_-]?path|localPath)\b/gi },
  { class: "secret_like", label: "secret_sk_proj", redactionToken: OUTBOUND_HERMES_SECRET_REDACTION, pattern: /sk-proj-[A-Za-z0-9_-]{20,}/gi },
  { class: "secret_like", label: "secret_sk", redactionToken: OUTBOUND_HERMES_SECRET_REDACTION, pattern: /sk-(?!proj-)[A-Za-z0-9_-]{20,}/gi },
  { class: "secret_like", label: "secret_bearer", redactionToken: OUTBOUND_HERMES_SECRET_REDACTION, pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/gi },
];

export interface OutboundHermesBlockedDiagnostic {
  path: string;
  class: OutboundHermesBlockedClass;
  label: string;
  sample: string;
}

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
  blockedLiteralLabels: string[];
  blockedClasses: OutboundHermesBlockedClass[];
  blockedDiagnostics: OutboundHermesBlockedDiagnostic[];
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

const withoutSafeOutboundRedactionTokens = (value: string): string =>
  value.replace(SAFE_OUTBOUND_REDACTION_TOKEN_PATTERN, "");

const outboundHermesUnsafeTextMatchesWithLiterals = (
  value: string,
): Array<{ rule: OutboundHermesUnsafeTextRule; literal: string }> => {
  const rawValue = withoutSafeOutboundRedactionTokens(value);

  return OUTBOUND_HERMES_UNSAFE_TEXT_RULES.flatMap((rule) =>
    Array.from(rawValue.matchAll(rule.pattern)).map((match) => ({
      rule,
      literal: match[0],
    })));
};

export const outboundHermesStringForbiddenMatches = (value: string): OutboundHermesForbiddenMatch[] => {
  const seen = new Set<string>();

  return outboundHermesUnsafeTextMatchesWithLiterals(value).flatMap(({ rule }) => {
    const key = `${rule.class}:${rule.label}`;

    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [{
      class: rule.class,
      label: rule.label,
      redactionToken: rule.redactionToken,
    }];
  });
};

export const outboundHermesStringHasForbiddenArtifactText = (value: string): boolean =>
  outboundHermesStringForbiddenMatches(value).length > 0;

export const outboundHermesCallsiteBlockedLiteralLabels = (outboundPayloadJson: string): string[] =>
  uniqueLimited(
    outboundHermesStringForbiddenMatches(outboundPayloadJson).map((match) => match.label),
    OUTBOUND_HERMES_UNSAFE_TEXT_RULES.length,
  );

export const outboundHermesBlockedClassesForLabels = (labels: string[]): Array<Exclude<OutboundHermesBlockedClass, "serialized_payload_string_match">> =>
  Array.from(new Set(
    labels.flatMap((label) =>
      OUTBOUND_HERMES_UNSAFE_TEXT_RULES
        .filter((rule) => rule.label === label)
        .map((rule) => rule.class)),
  ));

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

const jsonPath = (path: JsonPathSegment[]): string =>
  path.reduce<string>((current, segment) => {
    if (typeof segment === "number") {
      return `${current}[${segment}]`;
    }

    const safeSegment = outboundHermesStringHasForbiddenArtifactText(segment)
      ? "[redacted_key]"
      : segment;

    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(safeSegment)
      ? `${current}.${safeSegment}`
      : `${current}[${JSON.stringify(safeSegment)}]`;
  }, "$");

const uniqueLimited = (values: string[], limit: number): string[] =>
  Array.from(new Set(values)).slice(0, limit);

const uniqueBlockedDiagnostics = (
  values: OutboundHermesBlockedDiagnostic[],
  limit = MAX_FIELD_PREVIEW_COUNT,
): OutboundHermesBlockedDiagnostic[] => {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = `${value.path}:${value.class}:${value.label}`;

    if (seen.has(key) || seen.size >= limit) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const blockedSample = (blockedClass: OutboundHermesBlockedClass): string =>
  `[redacted:${blockedClass}]`;

const literalEntriesForString = (value: string): Array<{ literal: string; label: string }> =>
  outboundHermesUnsafeTextMatchesWithLiterals(value).map(({ rule, literal }) => ({
    literal,
    label: rule.label,
  }));

export function sanitizeOutboundHermesContextText(value: string): string {
  return OUTBOUND_HERMES_UNSAFE_TEXT_RULES.reduce(
    (redactedValue, rule) => redactedValue.replace(rule.pattern, rule.redactionToken),
    value,
  );
}

const sanitizedSnippetAroundLiteral = (value: string, literal: string): string => {
  const index = value.indexOf(literal);
  if (index < 0) {
    return "";
  }

  const start = Math.max(0, index - 32);
  const end = Math.min(value.length, index + literal.length + 32);
  const snippet = sanitizeOutboundHermesContextText(value.slice(start, end).replace(/\s+/g, " "));

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

const parseSerializedOutboundPayload = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
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
    const parsedValue = parseSerializedOutboundPayload(value);

    if (parsedValue !== value) {
      collectCallsiteBlockedStringFields(parsedValue, [], result);
    } else {
      for (const match of literalEntriesForString(value)) {
        result.literals.push(match.label);
        if (result.snippets.length < MAX_CALLSITE_SNIPPETS) {
          const snippet = sanitizedSnippetAroundLiteral(value, match.literal);
          if (snippet) {
            result.snippets.push(snippet);
          }
        }
      }
    }
  } else {
    collectCallsiteBlockedStringFields(value, [], result);
  }

  return {
    literals: uniqueLimited(result.literals, OUTBOUND_HERMES_UNSAFE_TEXT_RULES.length),
    sources: result.literals.length ? [source] : [],
    snippets: uniqueLimited(result.snippets, MAX_CALLSITE_SNIPPETS),
    paths: uniqueLimited(result.paths, MAX_CALLSITE_PATHS),
  };
};

export const mergeOutboundHermesCallsiteBlockInspections = (
  inspections: OutboundHermesCallsiteBlockInspection[],
): OutboundHermesCallsiteBlockInspection => ({
  literals: uniqueLimited(inspections.flatMap((inspection) => inspection.literals), OUTBOUND_HERMES_UNSAFE_TEXT_RULES.length),
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
    if (!outboundHermesStringHasForbiddenArtifactText(sanitizedContextText)) {
      if (sanitizedContextText !== value) {
        sanitizedFields.push(fieldPathPreview(path));
      }

      return sanitizedContextText;
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

const redactFinalOutboundPayloadStrings = (
  value: unknown,
  path: JsonPathSegment[],
  redactedFields: string[],
): unknown => {
  if (typeof value === "string") {
    const redactedValue = sanitizeOutboundHermesContextText(value);

    if (redactedValue !== value) {
      redactedFields.push(fieldPathPreview(path));
    }

    return redactedValue;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactFinalOutboundPayloadStrings(item, [...path, index], redactedFields));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const safeKey = safeReplacementForKey(key);

      if (safeKey !== key) {
        redactedFields.push(fieldPathPreview([...path, key]));
      }

      return [
        safeKey,
        redactFinalOutboundPayloadStrings(item, [...path, safeKey], redactedFields),
      ];
    }),
  );
};

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

export const collectOutboundHermesBlockedDiagnostics = (
  value: unknown,
  path: JsonPathSegment[] = [],
  diagnostics: OutboundHermesBlockedDiagnostic[] = [],
): OutboundHermesBlockedDiagnostic[] => {
  if (typeof value === "string") {
    for (const match of outboundHermesStringForbiddenMatches(value)) {
      diagnostics.push({
        path: jsonPath(path),
        class: match.class,
        label: match.label,
        sample: blockedSample(match.class),
      });
    }

    return diagnostics;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectOutboundHermesBlockedDiagnostics(item, [...path, index], diagnostics));
    return diagnostics;
  }

  if (!isRecord(value)) {
    return diagnostics;
  }

  Object.entries(value).forEach(([key, item]) => {
    const keyPath = [...path, key];
    for (const match of outboundHermesStringForbiddenMatches(key)) {
      diagnostics.push({
        path: jsonPath(keyPath),
        class: match.class,
        label: match.label,
        sample: blockedSample(match.class),
      });
    }

    collectOutboundHermesBlockedDiagnostics(item, keyPath, diagnostics);
  });

  return diagnostics;
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
  const finalOutboundRedactedFields: string[] = [];
  const finalOutboundPayload = redactFinalOutboundPayloadStrings(
    sanitizedPayload,
    [],
    finalOutboundRedactedFields,
  ) as T;
  const uniqueSanitizedFields = Array.from(new Set([
    ...sanitizedFields,
    ...finalOutboundRedactedFields,
  ]));
  const provisionalDiagnostics: OutboundHermesPayloadSanitizerDiagnostics = {
    outbound_hermes_payload_sanitized: uniqueSanitizedFields.length > 0,
    outbound_hermes_payload_path_like_blocked: false,
    outbound_sanitized_field_count: uniqueSanitizedFields.length,
    outbound_sanitized_fields_preview: uniqueSanitizedFields.slice(0, MAX_FIELD_PREVIEW_COUNT),
    ...(options.creativeRoute ? { workspace_fallback_suppressed_for_creative: true } : {}),
  };
  const blockedFields = collectBlockedFields(finalOutboundPayload);
  const serializedPayload = JSON.stringify(finalOutboundPayload);
  const serializedPayloadValue = parseSerializedOutboundPayload(serializedPayload);
  const serializedBlockedDiagnostics = uniqueBlockedDiagnostics(
    collectOutboundHermesBlockedDiagnostics(serializedPayloadValue),
  );
  const serializedPayloadBlocked = serializedBlockedDiagnostics.length > 0;
  const blockedDiagnostics = uniqueBlockedDiagnostics(collectOutboundHermesBlockedDiagnostics(finalOutboundPayload));
  const diagnosticRuleKeys = new Set(blockedDiagnostics.map((diagnostic) => `${diagnostic.class}:${diagnostic.label}`));

  for (const diagnostic of serializedBlockedDiagnostics) {
    const key = `${diagnostic.class}:${diagnostic.label}`;

    if (diagnosticRuleKeys.has(key)) {
      continue;
    }

    blockedDiagnostics.push({
      ...diagnostic,
    });
    diagnosticRuleKeys.add(key);
  }

  if (serializedPayloadBlocked && blockedDiagnostics.length === 0) {
    blockedDiagnostics.push({
      path: "$",
      class: "serialized_payload_string_match",
      label: "serialized_payload_string_match",
      sample: blockedSample("serialized_payload_string_match"),
    });
  }

  const blockedFieldsPreview = uniqueLimited(
    blockedDiagnostics.map((diagnostic) => diagnostic.path),
    MAX_FIELD_PREVIEW_COUNT,
  );
  const blockedLiteralLabels = Array.from(new Set(blockedDiagnostics.map((diagnostic) => diagnostic.label)));
  const blockedClasses = Array.from(new Set(blockedDiagnostics.map((diagnostic) => diagnostic.class)));
  const diagnostics: OutboundHermesPayloadSanitizerDiagnostics = {
    ...provisionalDiagnostics,
    outbound_hermes_payload_path_like_blocked: blockedFields.length > 0 || serializedPayloadBlocked,
  };

  return {
    payload: addDiagnostics(finalOutboundPayload, diagnostics),
    diagnostics,
    blockedFieldsPreview,
    blockedLiteralLabels,
    blockedClasses,
    blockedDiagnostics,
  };
}
