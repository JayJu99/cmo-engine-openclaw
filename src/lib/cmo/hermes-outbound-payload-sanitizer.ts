const OUTBOUND_FORBIDDEN_TEXT_PATTERN =
  /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|file:|\/(?:tmp|Users|home|var|mnt|private|Volumes)\/|(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|conversion_h_|creative-agent-images|cmo-creative-execute|\.(?:png_redact|png|jpe?g|webp|mp4|webm)(?:\b|_|$))/i;
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
  { literal: "/private/", label: "/private/" },
  { literal: "/Volumes/", label: "/Volumes/" },
  { literal: "file:", label: "file:" },
  { literal: "conversion_h_", label: "conversion_h_" },
  { literal: "creative-agent-images", label: "creative-agent-images" },
  { literal: "cmo-creative-execute", label: "cmo-creative-execute" },
] as const;

const TEXT_PLACEHOLDER =
  "Creative artifact text was redacted by Product before sending this turn to Hermes. Use canonical chat text and Product reference asset metadata for context.";
const ASSISTANT_PLACEHOLDER =
  "Creative asset was generated or updated. Use active asset metadata and reference_assets for visual context.";
const USER_PLACEHOLDER =
  "User message included an internal artifact reference that Product redacted before sending this turn to Hermes.";

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
}

export interface OutboundHermesPayloadSanitizerResult<T> {
  payload: T;
  diagnostics: OutboundHermesPayloadSanitizerDiagnostics;
  blockedFieldsPreview: string[];
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

    return typeof segment === "number" ? String(segment) : segment;
  }).join(".");

  return preview.slice(0, 180);
};

const uniqueLimited = (values: string[], limit: number): string[] =>
  Array.from(new Set(values)).slice(0, limit);

const literalEntriesForString = (value: string): Array<{ literal: string; label: string }> =>
  OUTBOUND_CALLSITE_FORBIDDEN_LITERALS.filter(({ literal }) => value.includes(literal));

const sanitizedSnippetAroundLiteral = (value: string, literal: string): string => {
  const index = value.indexOf(literal);
  if (index < 0) {
    return "";
  }

  const start = Math.max(0, index - 32);
  const end = Math.min(value.length, index + literal.length + 32);
  const snippet = value.slice(start, end)
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z]:[\\/][^"',\s}]+/g, "[local_path_redacted]")
    .replace(/file:[^"',\s}]+/gi, "file:[local_path_redacted]")
    .replace(/\/(?:tmp|Users|home|var|mnt|private|Volumes)\/[^"',\s}]+/g, (match) => {
      const prefix = match.match(/^\/(?:tmp|Users|home|var|mnt|private|Volumes)\//)?.[0] ?? "/local/";
      return `${prefix}[local_path_redacted]`;
    });

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

const sanitizeValue = (
  value: unknown,
  path: JsonPathSegment[],
  parent: Record<string, unknown> | undefined,
  sanitizedFields: string[],
): unknown => {
  if (typeof value === "string") {
    if (!outboundHermesStringHasForbiddenArtifactText(value)) {
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
    Object.entries(value).map(([key, item]) => [
      key,
      sanitizeValue(item, [...path, key], value, sanitizedFields),
    ]),
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
