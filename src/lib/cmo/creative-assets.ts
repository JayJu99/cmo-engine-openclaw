import "server-only";

import { createHash, randomUUID } from "crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  CMO_CREATIVE_AGENT_ID,
  isBrowserPreviewUrl,
  redactSensitiveText,
  redactedLocalArtifactPath,
  type CmoCreativeAssetArtifact,
} from "@/lib/cmo/creative-agent";

export const CMO_CREATIVE_ASSETS_BUCKET = "cmo-creative-assets";
export const CMO_CREATIVE_ASSET_SIGNED_URL_TTL_SECONDS = 60 * 60;
export const CMO_CREATIVE_ASSET_MAX_BYTES = 50 * 1024 * 1024;

export const CMO_CREATIVE_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/webm",
] as const;

export type CmoCreativeMimeType = (typeof CMO_CREATIVE_ALLOWED_MIME_TYPES)[number];

export interface UploadCmoCreativeArtifactInput {
  file: File;
  metadata: Record<string, unknown>;
  tenantId: string;
  workspaceId: string;
  appId: string;
  jobId?: string;
}

const ALLOWED_MIME_TYPES = new Set<string>(CMO_CREATIVE_ALLOWED_MIME_TYPES);
const MIME_BY_EXTENSION: Record<string, CmoCreativeMimeType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
};

function stringValue(value: unknown, max = 1200): string | undefined {
  return typeof value === "string" && value.trim() ? redactSensitiveText(value, max) : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function sha256Value(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : undefined;
}

function safePathSegment(value: string, fallback: string): string {
  const safe = value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^A-Za-z0-9_. -]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 140)
    .trim();

  return safe || fallback;
}

function fileExtension(filename: string): string {
  const normalized = filename.toLowerCase();
  const lastDot = normalized.lastIndexOf(".");

  return lastDot >= 0 ? normalized.slice(lastDot + 1) : "";
}

function normalizeMimeType(file: File): CmoCreativeMimeType | null {
  const declared = file.type.trim().toLowerCase();
  const extensionMime = MIME_BY_EXTENSION[fileExtension(file.name)];

  if (extensionMime && (!declared || declared === extensionMime || declared === "application/octet-stream")) {
    return extensionMime;
  }

  if (ALLOWED_MIME_TYPES.has(declared)) {
    return declared as CmoCreativeMimeType;
  }

  return extensionMime ?? null;
}

function validateFile(file: File, mimeType: CmoCreativeMimeType) {
  if (!file.name.trim()) {
    throw new Error("Creative artifact filename is required.");
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported creative artifact type: ${file.type || "unknown"}.`);
  }

  if (file.size <= 0) {
    throw new Error("Creative artifact file is empty.");
  }

  if (file.size > CMO_CREATIVE_ASSET_MAX_BYTES) {
    throw new Error(`Creative artifact is too large. Limit is ${CMO_CREATIVE_ASSET_MAX_BYTES} bytes.`);
  }
}

async function ensureCreativeBucket() {
  const supabase = createSupabaseAdminClient();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    throw new Error(`Unable to list Supabase Storage buckets: ${listError.message}`);
  }

  if (buckets.some((bucket) => bucket.name === CMO_CREATIVE_ASSETS_BUCKET)) {
    return supabase;
  }

  const { error } = await supabase.storage.createBucket(CMO_CREATIVE_ASSETS_BUCKET, {
    public: false,
    allowedMimeTypes: [...CMO_CREATIVE_ALLOWED_MIME_TYPES],
    fileSizeLimit: CMO_CREATIVE_ASSET_MAX_BYTES,
  });

  if (error) {
    throw new Error(`Unable to create Supabase creative bucket: ${error.message}`);
  }

  return supabase;
}

function metadataSha(metadata: Record<string, unknown>): string | undefined {
  return sha256Value(metadata.sha256) ?? sha256Value(metadata.expected_sha256);
}

function assetTypeFromMime(mimeType: CmoCreativeMimeType): "image" | "video" {
  return mimeType.startsWith("video/") ? "video" : "image";
}

function redactedMetadataValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value, 1200);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactedMetadataValue(item, depth + 1));
  }

  if (typeof value !== "object" || value === null || depth >= 4) {
    return undefined;
  }

  const output: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (/authorization|cookie|credential|password|private[_-]?key|secret|token/i.test(key)) {
      output[key] = "[redacted_secret]";
      continue;
    }

    if (key === "path" || key === "source_local_path" || key === "sourceLocalPath") {
      output.source_local_path_redacted = redactedLocalArtifactPath(nested);
      continue;
    }

    const redacted = redactedMetadataValue(nested, depth + 1);
    if (redacted !== undefined) {
      output[key] = redacted;
    }
  }

  return output;
}

function redactedMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const value = redactedMetadataValue(metadata);

  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function uploadCmoCreativeArtifact(input: UploadCmoCreativeArtifactInput): Promise<CmoCreativeAssetArtifact> {
  const mimeType = normalizeMimeType(input.file);

  if (!mimeType) {
    throw new Error(`Unsupported creative artifact type: ${input.file.type || "unknown"}.`);
  }

  validateFile(input.file, mimeType);

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expectedSha256 = metadataSha(input.metadata);

  if (expectedSha256 && expectedSha256 !== sha256) {
    throw new Error("Creative artifact sha256 mismatch.");
  }

  const createdAt = new Date().toISOString();
  const jobId = stringValue(input.jobId ?? input.metadata.job_id ?? input.metadata.jobId, 96) ?? `creative_job_${randomUUID().slice(0, 12)}`;
  const assetId = stringValue(input.metadata.asset_id ?? input.metadata.assetId, 120) ?? `creative_${randomUUID().slice(0, 12)}`;
  const filename = safePathSegment(input.file.name, "creative-asset");
  const storagePath = [
    safePathSegment(input.tenantId, "tenant"),
    safePathSegment(input.workspaceId, "workspace"),
    safePathSegment(input.appId, "app"),
    safePathSegment(jobId, "job"),
    safePathSegment(assetId, "asset"),
    filename,
  ].join("/");
  const supabase = await ensureCreativeBucket();
  const { error: uploadError } = await supabase.storage
    .from(CMO_CREATIVE_ASSETS_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Creative artifact upload failed: ${uploadError.message}`);
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from(CMO_CREATIVE_ASSETS_BUCKET)
    .createSignedUrl(storagePath, CMO_CREATIVE_ASSET_SIGNED_URL_TTL_SECONDS);

  if (signedError) {
    throw new Error(`Unable to create creative artifact signed URL: ${signedError.message}`);
  }

  const previewUrl = isBrowserPreviewUrl(signedData.signedUrl) ? signedData.signedUrl : undefined;
  const promptUsed = stringValue(input.metadata.prompt_used ?? input.metadata.promptUsed, 3000);
  const visualSummary = stringValue(input.metadata.visual_summary ?? input.metadata.visualSummary, 2000);
  const sourceLocalPath = redactedLocalArtifactPath(input.metadata.path ?? input.metadata.source_local_path);
  const asset: CmoCreativeAssetArtifact = {
    schema_version: "cmo.creative_asset.v1",
    type: "creative_asset",
    asset_id: assetId,
    job_id: jobId,
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    app_id: input.appId,
    agent: CMO_CREATIVE_AGENT_ID,
    asset_type: assetTypeFromMime(mimeType),
    provider: stringValue(input.metadata.provider, 160) ?? "codex-imagen",
    ...(promptUsed ? { prompt_used: promptUsed } : {}),
    ...(visualSummary ? { visual_summary: visualSummary } : {}),
    storage_path: storagePath,
    ...(previewUrl ? { preview_url: previewUrl, signed_url: previewUrl } : {}),
    ...(sourceLocalPath ? { source_local_path_redacted: sourceLocalPath } : {}),
    bytes: bytes.byteLength,
    sha256,
    ...(numberValue(input.metadata.width) !== undefined ? { width: numberValue(input.metadata.width) } : {}),
    ...(numberValue(input.metadata.height) !== undefined ? { height: numberValue(input.metadata.height) } : {}),
    ...(stringValue(input.metadata.model, 160) ? { model: stringValue(input.metadata.model, 160) } : {}),
    ...(stringValue(input.metadata.operation, 220) ? { operation: stringValue(input.metadata.operation, 220) } : {}),
    status: "stored",
    ...(stringValue(input.metadata.notes, 1200) ? { notes: stringValue(input.metadata.notes, 1200) } : {}),
    transport_status: "available",
    review_required: true,
    created_at: createdAt,
  };

  const { error: jobError } = await supabase.from("cmo_creative_jobs").upsert({
    id: jobId,
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    app_id: input.appId,
    agent: CMO_CREATIVE_AGENT_ID,
    status: "asset_ready",
    prompt_used: promptUsed ?? null,
    visual_summary: visualSummary ?? null,
    created_at: createdAt,
    updated_at: createdAt,
  }, { onConflict: "id" });

  if (jobError) {
    throw new Error(`Creative job metadata upsert failed: ${jobError.message}`);
  }

  const { error: insertError } = await supabase.from("cmo_creative_assets").insert({
    id: asset.asset_id,
    job_id: jobId,
    tenant_id: input.tenantId,
    workspace_id: input.workspaceId,
    app_id: input.appId,
    agent: CMO_CREATIVE_AGENT_ID,
    type: asset.asset_type,
    provider: asset.provider ?? null,
    prompt_used: asset.prompt_used ?? null,
    visual_summary: asset.visual_summary ?? null,
    storage_path: storagePath,
    preview_url: previewUrl ?? null,
    signed_url: previewUrl ?? null,
    source_local_path_redacted: asset.source_local_path_redacted ?? null,
    bytes: asset.bytes ?? null,
    sha256,
    width: asset.width ?? null,
    height: asset.height ?? null,
    model: asset.model ?? null,
    operation: asset.operation ?? null,
    status: asset.status,
    metadata_json: redactedMetadata(input.metadata),
    created_at: createdAt,
  });

  if (insertError) {
    throw new Error(`Creative asset metadata insert failed: ${insertError.message}`);
  }

  return asset;
}
