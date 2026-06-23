const OUTBOUND_FORBIDDEN_TEXT_PATTERN =
  /(\[hermes_local_artifact_path_redacted\]|hermes_local_artifact_path_redacted|\/tmp\/|\/Users\/|conversion_h_|creative-agent-images|cmo-creative-execute|reference_assets|\.png_redact|\.(?:png|jpe?g|webp|mp4|webm)\b)/i;

const TEXT_PLACEHOLDER =
  "Creative artifact text was redacted by Product before sending this turn to Hermes. Use canonical chat text and Product reference asset metadata for context.";
const ASSISTANT_PLACEHOLDER =
  "Creative asset was generated or updated. Use active asset metadata and Product reference assets for visual context.";
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

const MAX_FIELD_PREVIEW_COUNT = 16;

type JsonPathSegment = string | number;

export interface OutboundHermesPayloadSanitizerDiagnostics {
  outbound_hermes_payload_sanitized: boolean;
  outbound_hermes_payload_path_like_blocked: boolean;
  outbound_sanitized_field_count: number;
  outbound_sanitized_fields_preview: string[];
  workspace_fallback_suppressed_for_creative?: true;
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

export function sanitizeOutboundHermesPayload<T>(
  payload: T,
  options: { creativeRoute?: boolean } = {},
): OutboundHermesPayloadSanitizerResult<T> {
  const sanitizedFields: string[] = [];
  const sanitizedPayload = sanitizeValue(payload, [], undefined, sanitizedFields) as T;
  const uniqueSanitizedFields = Array.from(new Set(sanitizedFields));
  const blockedFields = collectBlockedFields(sanitizedPayload);
  const diagnostics: OutboundHermesPayloadSanitizerDiagnostics = {
    outbound_hermes_payload_sanitized: uniqueSanitizedFields.length > 0,
    outbound_hermes_payload_path_like_blocked: blockedFields.length > 0,
    outbound_sanitized_field_count: uniqueSanitizedFields.length,
    outbound_sanitized_fields_preview: uniqueSanitizedFields.slice(0, MAX_FIELD_PREVIEW_COUNT),
    ...(options.creativeRoute ? { workspace_fallback_suppressed_for_creative: true } : {}),
  };

  return {
    payload: addDiagnostics(sanitizedPayload, diagnostics),
    diagnostics,
    blockedFieldsPreview: Array.from(new Set(blockedFields)).slice(0, MAX_FIELD_PREVIEW_COUNT),
  };
}
