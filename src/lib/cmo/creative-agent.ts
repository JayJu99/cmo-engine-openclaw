import { isProductBackedRenderableCreativeAsset } from "./creative-draft-state";

export const CMO_CREATIVE_AGENT_ID = "creative" as const;
export const CMO_CREATIVE_AGENT_LABEL = "Creative Agent" as const;
export const CMO_CREATIVE_AGENT_ROLE = "visual execution specialist" as const;

export const CMO_CREATIVE_LIFECYCLE_STATES = [
  "creative.started",
  "creative.generating",
  "creative.asset_ready",
  "creative.partial",
  "creative.blocked",
  "creative.failed",
] as const;

export type CmoCreativeLifecycleState = (typeof CMO_CREATIVE_LIFECYCLE_STATES)[number];
export type CmoCreativeResponseStatus = "success" | "partial" | "blocked" | "failed";
export type CmoCreativeAssetStatus = "stored" | "artifact_transport_missing" | "partial" | "blocked" | "failed";
export type CmoCreativeAssetTransportStatus = "uploaded" | "available" | "artifact_transport_missing" | "artifact_transport_failed";
export type CmoCreativeAssetType = "image" | "video";

export interface CmoCreativeRequest {
  schema_version: "cmo.creative_request.v1";
  agent: typeof CMO_CREATIVE_AGENT_ID;
  task: "generate_image";
  format: "square" | "portrait" | "landscape" | string;
  variants: number;
  brief: {
    goal: string;
    subject: string;
    style?: string;
    palette?: string;
    must_include?: string[];
    avoid?: string[];
    language?: string;
  };
  output: {
    return_local_paths: true;
    include_metadata: true;
    require_review_before_publish: true;
  };
}

export interface CmoCreativeAssetArtifact {
  schema_version: "cmo.creative_asset.v1";
  type: "creative_asset";
  asset_id: string;
  job_id?: string;
  tenant_id?: string;
  workspace_id?: string;
  app_id?: string;
  agent: typeof CMO_CREATIVE_AGENT_ID;
  asset_type: CmoCreativeAssetType;
  provider?: string;
  prompt_used?: string;
  visual_summary?: string;
  storage_path?: string;
  storagePath?: string;
  render_url?: string;
  renderUrl?: string;
  preview_url?: string;
  previewUrl?: string;
  signed_url?: string;
  signedUrl?: string;
  source_local_path_redacted?: string;
  bytes?: number;
  sha256?: string;
  mime_type?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  model?: string;
  operation?: string;
  status: CmoCreativeAssetStatus;
  notes?: string;
  transport_status?: CmoCreativeAssetTransportStatus;
  transportStatus?: CmoCreativeAssetTransportStatus;
  review_required: true;
  created_at: string;
}

export interface CmoCreativeNormalizationContext {
  tenantId?: string;
  workspaceId?: string;
  appId?: string;
  jobId?: string;
  createdAt?: string;
}

const CREATIVE_LIFECYCLE_SET = new Set<string>(CMO_CREATIVE_LIFECYCLE_STATES);
const LOCAL_PATH_PATTERN = /^(?:file:|[A-Za-z]:[\\/]|\/(?:tmp|var|Users|home|private|Volumes)\b)/i;
const SENSITIVE_TEXT_PATTERN =
  /(Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{12,}|AKIA[0-9A-Z]{12,}|api[_-]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S+|cookie\s*[:=]\s*\S+|secret\s*[:=]\s*\S+)/gi;
const AUTH_PATH_PATTERN =
  /(?:[A-Za-z]:\\Users\\[^\\\s]+\\[^\s]*?\.codex\\auth\.json|\/Users\/[^/\s]+\/[^\s]*?\.codex\/auth\.json|\/home\/[^/\s]+\/[^\s]*?\.codex\/auth\.json|\.codex[\\/][^\s]*auth\.json|auth\.json)/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactText(value: string, max = 1200): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > max ? `${compact.slice(0, max - 3).trimEnd()}...` : compact;
}

function stringValue(value: unknown, max = 1200): string | undefined {
  return typeof value === "string" && value.trim() ? redactSensitiveText(value, max) : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function browserPreviewUrlFrom(values: unknown[]): string | undefined {
  for (const value of values) {
    if (isBrowserPreviewUrl(value)) {
      return value;
    }
  }

  return undefined;
}

function sha256Value(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : undefined;
}

function hasStringField(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => typeof value[field] === "string" && Boolean(value[field].trim()));
}

function hasNumberField(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => typeof value[field] === "number" && Number.isFinite(value[field]));
}

function safeIdSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 96) || "creative_asset";
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? "artifact";
}

function statusFromCreativeStatus(value: unknown, hasPreview: boolean): CmoCreativeAssetStatus {
  if (value === "failed") return "failed";
  if (value === "blocked") return "blocked";
  if (value === "partial") return hasPreview ? "partial" : "artifact_transport_missing";
  return hasPreview ? "stored" : "artifact_transport_missing";
}

function creativeArtifactIdentity(asset: CmoCreativeAssetArtifact): string | undefined {
  const value = asset.signed_url ?? asset.render_url ?? asset.preview_url ?? asset.storage_path ?? asset.sha256;

  if (!value) {
    return undefined;
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return value;
    }
  }

  return value;
}

function dedupeCreativeArtifacts(assets: CmoCreativeAssetArtifact[]): CmoCreativeAssetArtifact[] {
  const byId = new Map<string, CmoCreativeAssetArtifact>();
  const byIdentity = new Map<string, CmoCreativeAssetArtifact>();

  for (const asset of assets) {
    const existingById = byId.get(asset.asset_id);
    const merged = existingById ? { ...existingById, ...asset } : asset;
    const identity = creativeArtifactIdentity(merged);
    const existingByIdentity = identity ? byIdentity.get(identity) : undefined;
    const next = existingByIdentity ? { ...existingByIdentity, ...merged } : merged;

    byId.delete(next.asset_id);
    byId.set(next.asset_id, next);

    if (identity) {
      byIdentity.delete(identity);
      byIdentity.set(identity, next);
    }
  }

  const identityWinners = new Set(byIdentity.values());

  return Array.from(byId.values()).filter((asset) => {
    const identity = creativeArtifactIdentity(asset);

    return !identity || identityWinners.has(asset);
  });
}

export function isCreativeLifecycleState(value: unknown): value is CmoCreativeLifecycleState {
  return typeof value === "string" && CREATIVE_LIFECYCLE_SET.has(value);
}

export function redactSensitiveText(value: string, max = 1200): string {
  return compactText(value, max)
    .replace(AUTH_PATH_PATTERN, "[redacted_auth_path]")
    .replace(SENSITIVE_TEXT_PATTERN, "[redacted_secret]");
}

export function redactedLocalArtifactPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const redacted = redactSensitiveText(value, 400);
  const name = basename(redacted);

  if (redacted !== value || LOCAL_PATH_PATTERN.test(value)) {
    return `[hermes_local_artifact_path_redacted]/${safeIdSegment(name)}`;
  }

  return redacted;
}

export function isBrowserPreviewUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || LOCAL_PATH_PATTERN.test(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return value.startsWith("/");
  }
}

function transportStatusValue(value: unknown, hasPreview: boolean): CmoCreativeAssetTransportStatus {
  if (value === "uploaded") return "uploaded";
  if (value === "artifact_transport_failed") return "artifact_transport_failed";
  if (value === "artifact_transport_missing") return "artifact_transport_missing";
  if (value === "available") return "available";
  return hasPreview ? "available" : "artifact_transport_missing";
}

export function hasCreativeExecutionMetadata(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if (value.routed_to_creative === true) {
    return true;
  }

  return hasStringField(value, ["image_path", "path", "render_url", "renderUrl", "preview_url", "previewUrl", "signed_url", "signedUrl", "url", "storage_path", "storagePath", "sha256", "model", "operation"]) ||
    hasNumberField(value, ["bytes", "width", "height"]);
}

export function buildCreativeRequest(input: {
  goal: string;
  subject: string;
  style?: string;
  palette?: string;
  mustInclude?: string[];
  avoid?: string[];
  language?: string;
  format?: string;
  variants?: number;
}): CmoCreativeRequest {
  return {
    schema_version: "cmo.creative_request.v1",
    agent: CMO_CREATIVE_AGENT_ID,
    task: "generate_image",
    format: input.format ?? "square",
    variants: Math.max(1, Math.floor(input.variants ?? 1)),
    brief: {
      goal: input.goal,
      subject: input.subject,
      ...(input.style ? { style: input.style } : {}),
      ...(input.palette ? { palette: input.palette } : {}),
      ...(input.mustInclude?.length ? { must_include: input.mustInclude } : {}),
      ...(input.avoid?.length ? { avoid: input.avoid } : {}),
      ...(input.language ? { language: input.language } : {}),
    },
    output: {
      return_local_paths: true,
      include_metadata: true,
      require_review_before_publish: true,
    },
  };
}

export function normalizeCreativeResponse(
  value: unknown,
  context: CmoCreativeNormalizationContext = {},
): CmoCreativeAssetArtifact[] {
  if (!isRecord(value)) {
    return [];
  }

  const schema = value.schema_version;
  const agent = value.agent;
  const looksCreative =
    schema === "cmo.creative_response.v1" ||
    schema === "cmo.creative_asset.v1" ||
    agent === CMO_CREATIVE_AGENT_ID ||
    Array.isArray(value.images) && value.images.some(isRecord) ||
    Array.isArray(value.creative_assets) && value.creative_assets.some(isRecord) ||
    Array.isArray(value.generated_assets) && value.generated_assets.some(isRecord) ||
    hasCreativeExecutionMetadata(value);

  if (!looksCreative) {
    return [];
  }

  const status = value.status as CmoCreativeResponseStatus | undefined;
  const createdAt = context.createdAt ?? new Date().toISOString();
  const promptUsed = stringValue(value.prompt_used, 3000);
  const visualSummary = stringValue(value.visual_summary, 2000);
  const notes = stringValue(value.notes, 1200);
  const images = Array.isArray(value.creative_assets) && value.creative_assets.some(isRecord)
    ? value.creative_assets.filter(isRecord)
    : Array.isArray(value.generated_assets) && value.generated_assets.some(isRecord)
    ? value.generated_assets.filter(isRecord)
    : Array.isArray(value.images)
    ? value.images.filter(isRecord)
    : (
        value.image_path ||
        value.path ||
        value.render_url ||
        value.renderUrl ||
        value.preview_url ||
        value.previewUrl ||
        value.signed_url ||
        value.signedUrl ||
        value.url ||
        value.storage_path ||
        value.storagePath ||
        value.sha256
      )
      ? [{
          path: value.image_path ?? value.path,
          render_url: value.render_url ?? value.renderUrl,
          preview_url: value.preview_url ?? value.previewUrl,
          signed_url: value.signed_url ?? value.signedUrl,
          url: value.url,
          storage_path: value.storage_path ?? value.storagePath,
          asset_id: value.asset_id ?? value.id,
          asset_type: value.asset_type ?? value.assetType,
          transport_status: value.transport_status ?? value.transportStatus,
          provider: value.provider,
          bytes: value.bytes,
          mime_type: value.mime_type ?? value.mimeType,
          sha256: value.sha256,
          width: value.width,
          height: value.height,
          model: value.model,
          operation: value.operation,
        }]
      : [];

  return images.map((image, index) => {
    const path = stringValue(image.path, 600);
    const previewUrl = browserPreviewUrlFrom([
      image.signed_url,
      image.signedUrl,
      image.render_url,
      image.renderUrl,
      image.preview_url,
      image.previewUrl,
      image.url,
    ]);
    const storagePath = stringValue(image.storage_path ?? image.storagePath, 600);
    const hasPreview = Boolean(previewUrl || storagePath);
    const transportStatus = transportStatusValue(image.transport_status ?? image.transportStatus ?? value.transport_status ?? value.transportStatus, hasPreview);
    const sha256 = sha256Value(image.sha256);
    const explicitAssetId = stringValue(image.asset_id ?? image.id, 120);
    const assetId = explicitAssetId ?? `creative_${safeIdSegment(sha256 ?? `${context.jobId ?? "job"}_${index + 1}`)}`;
    const assetType = image.asset_type === "video" || image.assetType === "video" || image.type === "video" ? "video" : "image";
    const mimeType = stringValue(image.mime_type ?? image.mimeType, 120);

    return {
      schema_version: "cmo.creative_asset.v1",
      type: "creative_asset",
      asset_id: assetId,
      ...(context.jobId ? { job_id: context.jobId } : {}),
      ...(context.tenantId ? { tenant_id: context.tenantId } : {}),
      ...(context.workspaceId ? { workspace_id: context.workspaceId } : {}),
      ...(context.appId ? { app_id: context.appId } : {}),
      agent: CMO_CREATIVE_AGENT_ID,
      asset_type: assetType,
      provider: stringValue(image.provider ?? value.provider, 160) ?? "codex-imagen",
      ...(promptUsed ? { prompt_used: promptUsed } : {}),
      ...(visualSummary ? { visual_summary: visualSummary } : {}),
      ...(storagePath ? { storage_path: storagePath, storagePath } : {}),
      ...(previewUrl ? { render_url: previewUrl } : {}),
      ...(previewUrl ? { renderUrl: previewUrl } : {}),
      ...(previewUrl ? { preview_url: previewUrl } : {}),
      ...(previewUrl ? { previewUrl } : {}),
      ...(previewUrl ? { signed_url: previewUrl, signedUrl: previewUrl } : {}),
      ...(path ? { source_local_path_redacted: redactedLocalArtifactPath(path) } : {}),
      ...(numberValue(image.bytes) !== undefined ? { bytes: numberValue(image.bytes) } : {}),
      ...(sha256 ? { sha256 } : {}),
      ...(mimeType ? { mime_type: mimeType, mimeType } : {}),
      ...(numberValue(image.width) !== undefined ? { width: numberValue(image.width) } : {}),
      ...(numberValue(image.height) !== undefined ? { height: numberValue(image.height) } : {}),
      ...(stringValue(image.model ?? value.model, 160) ? { model: stringValue(image.model ?? value.model, 160) } : {}),
      ...(stringValue(image.operation ?? value.operation, 220) ? { operation: stringValue(image.operation ?? value.operation, 220) } : {}),
      status: statusFromCreativeStatus(status, hasPreview),
      ...(notes ? { notes } : {}),
      transport_status: transportStatus,
      transportStatus,
      review_required: true,
      created_at: createdAt,
    };
  });
}

export function extractCreativeAssetsFromHermesResponse(
  response: unknown,
  context: CmoCreativeNormalizationContext = {},
): CmoCreativeAssetArtifact[] {
  if (!isRecord(response)) {
    return [];
  }

  const structured = isRecord(response.structured_output) ? response.structured_output : {};
  const candidates = [
    response,
    structured.creative_response,
    structured.creative,
    ...(Array.isArray(response.creative_assets) ? response.creative_assets : []),
    ...(Array.isArray(structured.creative_assets) ? structured.creative_assets : []),
    ...(Array.isArray(response.generated_assets) ? response.generated_assets : []),
    ...(Array.isArray(structured.generated_assets) ? structured.generated_assets : []),
    isRecord(response.answer) ? response.answer : undefined,
    isRecord(response.response) ? response.response : undefined,
    isRecord(response.body) ? response.body : undefined,
    isRecord(response.data) ? response.data : undefined,
    ...(Array.isArray(response.artifacts) ? response.artifacts : []),
    ...(Array.isArray(structured.artifacts) ? structured.artifacts : []),
  ];
  const assets: CmoCreativeAssetArtifact[] = [];

  for (const candidate of candidates) {
    for (const asset of normalizeCreativeResponse(candidate, context)) {
      assets.push(asset);
    }
  }

  const productBackedAssets = assets.filter(isProductBackedRenderableCreativeAsset);

  return dedupeCreativeArtifacts(productBackedAssets.length ? productBackedAssets : assets);
}
