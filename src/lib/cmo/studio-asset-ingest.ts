import "server-only";

import { createHash, randomUUID } from "crypto";

import { CmoAdapterError } from "@/lib/cmo/errors";
import type { CmoRequestUserContext } from "@/lib/cmo/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertStudioJobExists } from "@/lib/cmo/studio-job-service";
import type { StudioMediaKind } from "@/lib/cmo/studio-model-catalog";

export type StudioAssetPurpose = "studio_input" | "studio_output";
export type StudioUploadSessionStatus = "pending" | "uploaded" | "completed" | "expired" | "failed";

export const STUDIO_ALLOWED_MIME_TYPES = ["video/mp4", "video/webm", "image/png", "image/jpeg", "image/webp"] as const;
export type StudioAllowedMimeType = (typeof STUDIO_ALLOWED_MIME_TYPES)[number];

const ALLOWED_MIME_SET = new Set<string>(STUDIO_ALLOWED_MIME_TYPES);
const DEFAULT_INPUT_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_INPUT_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_OUTPUT_IMAGE_MAX_BYTES = 24 * 1024 * 1024;
const DEFAULT_OUTPUT_VIDEO_MAX_BYTES = 400 * 1024 * 1024;
const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;

export interface StudioUploadSessionRecord {
  id: string;
  job_id: string;
  media_kind: StudioMediaKind;
  purpose: StudioAssetPurpose;
  status: StudioUploadSessionStatus;
  upload_target: string;
  storage_key: string;
  expected_mime_type: string | null;
  allowed_mime_types: string[];
  max_bytes: number;
  expires_at: string;
  uploaded_mime_type: string | null;
  uploaded_bytes: number | null;
  uploaded_sha256: string | null;
  created_at: string;
  completed_at: string | null;
  error_json: Record<string, unknown> | null;
}

export interface StudioAssetRecord {
  id: string;
  job_id: string;
  media_kind: StudioMediaKind;
  purpose: StudioAssetPurpose;
  storage_key: string;
  render_url: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  mime_type: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number.parseInt((process.env[name] ?? "").trim(), 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function studioAssetBucket(): string {
  return (process.env.CMO_STUDIO_ASSET_BUCKET ?? "").trim() || "cmo-studio-assets";
}

function normalizeMimeType(value: unknown): StudioAllowedMimeType | null {
  const mimeType = typeof value === "string" ? value.trim().toLowerCase() : "";

  return ALLOWED_MIME_SET.has(mimeType) ? mimeType as StudioAllowedMimeType : null;
}

function normalizeMediaKind(value: unknown, mimeType?: string | null): StudioMediaKind {
  if (value === "video" || value === "image") {
    return value;
  }

  return mimeType?.startsWith("image/") ? "image" : "video";
}

function normalizePurpose(value: unknown): StudioAssetPurpose {
  return value === "studio_output" ? "studio_output" : "studio_input";
}

function uploadMaxBytes(mediaKind: StudioMediaKind, purpose: StudioAssetPurpose): number {
  if (purpose === "studio_output") {
    return mediaKind === "video"
      ? envNumber("CMO_STUDIO_OUTPUT_VIDEO_MAX_BYTES", DEFAULT_OUTPUT_VIDEO_MAX_BYTES)
      : envNumber("CMO_STUDIO_OUTPUT_IMAGE_MAX_BYTES", DEFAULT_OUTPUT_IMAGE_MAX_BYTES);
  }

  return mediaKind === "video"
    ? envNumber("CMO_STUDIO_INPUT_VIDEO_MAX_BYTES", DEFAULT_INPUT_VIDEO_MAX_BYTES)
    : envNumber("CMO_STUDIO_INPUT_IMAGE_MAX_BYTES", DEFAULT_INPUT_IMAGE_MAX_BYTES);
}

function safeStorageSegment(value: string, fallback: string): string {
  const safe = value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .slice(0, 140)
    .replace(/^-+|-+$/g, "");

  return safe || fallback;
}

function extensionFromMime(mimeType: string | null): string {
  if (mimeType === "video/webm") {
    return "webm";
  }

  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "mp4";
}

function rowToSession(row: Record<string, unknown>): StudioUploadSessionRecord {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    media_kind: row.media_kind as StudioMediaKind,
    purpose: row.purpose as StudioAssetPurpose,
    status: row.status as StudioUploadSessionStatus,
    upload_target: String(row.upload_target ?? ""),
    storage_key: String(row.storage_key ?? ""),
    expected_mime_type: typeof row.expected_mime_type === "string" ? row.expected_mime_type : null,
    allowed_mime_types: Array.isArray(row.allowed_mime_types) ? row.allowed_mime_types.filter((item): item is string => typeof item === "string") : [],
    max_bytes: typeof row.max_bytes === "number" ? row.max_bytes : 0,
    expires_at: String(row.expires_at),
    uploaded_mime_type: typeof row.uploaded_mime_type === "string" ? row.uploaded_mime_type : null,
    uploaded_bytes: typeof row.uploaded_bytes === "number" ? row.uploaded_bytes : null,
    uploaded_sha256: typeof row.uploaded_sha256 === "string" ? row.uploaded_sha256 : null,
    created_at: String(row.created_at),
    completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
    error_json: isRecord(row.error_json) ? row.error_json : null,
  };
}

function rowToAsset(row: Record<string, unknown>): StudioAssetRecord {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    media_kind: row.media_kind as StudioMediaKind,
    purpose: row.purpose as StudioAssetPurpose,
    storage_key: String(row.storage_key),
    render_url: typeof row.render_url === "string" ? row.render_url : null,
    preview_url: typeof row.preview_url === "string" ? row.preview_url : null,
    thumbnail_url: typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
    mime_type: String(row.mime_type),
    bytes: typeof row.bytes === "number" ? row.bytes : 0,
    sha256: String(row.sha256),
    width: typeof row.width === "number" ? row.width : null,
    height: typeof row.height === "number" ? row.height : null,
    duration_seconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
    metadata_json: isRecord(row.metadata_json) ? row.metadata_json : {},
    created_at: String(row.created_at),
  };
}

async function ensureStudioAssetBucket() {
  const supabase = createSupabaseAdminClient();
  const bucket = studioAssetBucket();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    throw new CmoAdapterError("Unable to list Supabase Storage buckets.", 500, "studio_storage_bucket_lookup_failed");
  }

  if (buckets.some((item) => item.name === bucket)) {
    return supabase;
  }

  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
    allowedMimeTypes: [...STUDIO_ALLOWED_MIME_TYPES],
    fileSizeLimit: DEFAULT_OUTPUT_VIDEO_MAX_BYTES,
  });

  if (error) {
    throw new CmoAdapterError(`Unable to create Studio asset bucket: ${error.message}`, 500, "studio_storage_bucket_create_failed");
  }

  return supabase;
}

async function loadSession(sessionId: string): Promise<StudioUploadSessionRecord> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("studio_asset_upload_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new CmoAdapterError("Studio upload session lookup failed.", 500, "studio_upload_session_lookup_failed");
  }

  if (!data) {
    throw new CmoAdapterError("Studio upload session not found.", 404, "studio_upload_session_not_found");
  }

  return rowToSession(data);
}

function assertSessionOpen(session: StudioUploadSessionRecord) {
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new CmoAdapterError("Studio upload session expired.", 410, "studio_upload_session_expired");
  }

  if (!["pending", "uploaded"].includes(session.status)) {
    throw new CmoAdapterError("Studio upload session is closed.", 409, "studio_upload_session_closed");
  }
}

export async function createStudioAssetUploadSession(input: {
  context: CmoRequestUserContext;
  jobId: string;
  mediaKind?: unknown;
  purpose?: unknown;
  expectedMimeType?: unknown;
}): Promise<StudioUploadSessionRecord> {
  const expectedMimeType = normalizeMimeType(input.expectedMimeType);

  if (input.expectedMimeType && !expectedMimeType) {
    throw new CmoAdapterError("Unsupported Studio asset MIME type.", 400, "studio_asset_unsupported_mime");
  }

  const job = await assertStudioJobExists(input.context, input.jobId);
  const mediaKind = normalizeMediaKind(input.mediaKind ?? job.media_kind, expectedMimeType);
  const purpose = normalizePurpose(input.purpose);
  const maxBytes = uploadMaxBytes(mediaKind, purpose);
  const now = new Date();
  const sessionId = `studio_upload_${randomUUID()}`;
  const storageKey = [
    safeStorageSegment(job.tenant_id, "tenant"),
    safeStorageSegment(job.id, "job"),
    purpose,
    `${safeStorageSegment(sessionId, "session")}.${extensionFromMime(expectedMimeType)}`,
  ].join("/");
  const row = {
    id: sessionId,
    job_id: job.id,
    media_kind: mediaKind,
    purpose,
    status: "pending",
    upload_target: `/api/cmo/studio/assets/ingest/upload/${sessionId}`,
    storage_key: storageKey,
    expected_mime_type: expectedMimeType,
    allowed_mime_types: [...STUDIO_ALLOWED_MIME_TYPES],
    max_bytes: maxBytes,
    expires_at: new Date(now.getTime() + UPLOAD_SESSION_TTL_MS).toISOString(),
    uploaded_mime_type: null,
    uploaded_bytes: null,
    uploaded_sha256: null,
    created_at: now.toISOString(),
    completed_at: null,
    error_json: null,
  };
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("studio_asset_upload_sessions")
    .insert(row)
    .select("*")
    .single();

  if (error || !data) {
    throw new CmoAdapterError("Studio upload session create failed.", 500, "studio_upload_session_create_failed");
  }

  return rowToSession(data);
}

export async function uploadStudioAssetSessionBytes(input: {
  sessionId: string;
  contentType: string | null;
  bytes: ArrayBuffer;
}): Promise<StudioUploadSessionRecord> {
  const session = await loadSession(input.sessionId);

  assertSessionOpen(session);

  const mimeType = normalizeMimeType(input.contentType);

  if (!mimeType) {
    throw new CmoAdapterError("Unsupported Studio asset MIME type.", 400, "studio_asset_unsupported_mime");
  }

  if (session.expected_mime_type && session.expected_mime_type !== mimeType) {
    throw new CmoAdapterError("Studio asset MIME type does not match the upload session.", 400, "studio_asset_mime_mismatch");
  }

  if (!session.allowed_mime_types.includes(mimeType)) {
    throw new CmoAdapterError("Unsupported Studio asset MIME type.", 400, "studio_asset_unsupported_mime");
  }

  const buffer = Buffer.from(input.bytes);

  if (buffer.byteLength <= 0) {
    throw new CmoAdapterError("Studio asset upload is empty.", 400, "studio_asset_empty");
  }

  if (buffer.byteLength > session.max_bytes) {
    throw new CmoAdapterError("Studio asset upload exceeds the session size limit.", 413, "studio_asset_too_large");
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const supabase = await ensureStudioAssetBucket();
  const { error: uploadError } = await supabase.storage
    .from(studioAssetBucket())
    .upload(session.storage_key, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new CmoAdapterError(`Studio asset upload failed: ${uploadError.message}`, 500, "studio_asset_upload_failed");
  }

  const { data, error } = await supabase
    .from("studio_asset_upload_sessions")
    .update({
      status: "uploaded",
      uploaded_mime_type: mimeType,
      uploaded_bytes: buffer.byteLength,
      uploaded_sha256: sha256,
    })
    .eq("id", session.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new CmoAdapterError("Studio upload session update failed.", 500, "studio_upload_session_update_failed");
  }

  return rowToSession(data);
}

export async function completeStudioAssetUpload(input: {
  context: CmoRequestUserContext;
  sessionId: string;
  width?: unknown;
  height?: unknown;
  durationSeconds?: unknown;
  metadata?: unknown;
}): Promise<StudioAssetRecord> {
  const session = await loadSession(input.sessionId);

  assertSessionOpen(session);
  await assertStudioJobExists(input.context, session.job_id);

  if (session.status !== "uploaded") {
    throw new CmoAdapterError("Studio upload session has no uploaded bytes.", 409, "studio_upload_session_not_uploaded");
  }

  if (!session.uploaded_mime_type || !session.uploaded_bytes || !session.uploaded_sha256) {
    throw new CmoAdapterError("Studio upload session is missing upload metadata.", 409, "studio_upload_session_missing_metadata");
  }

  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const assetId = `studio_asset_${randomUUID()}`;
  const width = typeof input.width === "number" && Number.isFinite(input.width) ? Math.floor(input.width) : null;
  const height = typeof input.height === "number" && Number.isFinite(input.height) ? Math.floor(input.height) : null;
  const durationSeconds = typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)
    ? Math.max(0, input.durationSeconds)
    : null;
  const assetRow = {
    id: assetId,
    job_id: session.job_id,
    media_kind: session.media_kind,
    purpose: session.purpose,
    storage_key: session.storage_key,
    render_url: null,
    preview_url: null,
    thumbnail_url: null,
    mime_type: session.uploaded_mime_type,
    bytes: session.uploaded_bytes,
    sha256: session.uploaded_sha256,
    width,
    height,
    duration_seconds: durationSeconds,
    metadata_json: isRecord(input.metadata) ? input.metadata : {},
    created_at: now,
  };
  const { data, error } = await supabase
    .from("studio_assets")
    .insert(assetRow)
    .select("*")
    .single();

  if (error || !data) {
    throw new CmoAdapterError("Studio asset metadata create failed.", 500, "studio_asset_metadata_create_failed");
  }

  const asset = rowToAsset(data);
  const assetColumn = session.purpose === "studio_output" ? "output_asset_ids" : "input_asset_ids";
  const { data: jobData } = await supabase
    .from("studio_generation_jobs")
    .select("input_asset_ids,output_asset_ids")
    .eq("id", session.job_id)
    .maybeSingle();
  const jobAssetIds = isRecord(jobData) ? jobData as Record<string, unknown> : {};
  const currentIds = jobAssetIds[assetColumn];
  const nextIds = Array.from(new Set([...(Array.isArray(currentIds) ? currentIds.filter((item): item is string => typeof item === "string") : []), asset.id]));

  await supabase
    .from("studio_generation_jobs")
    .update({ [assetColumn]: nextIds })
    .eq("id", session.job_id);

  await supabase
    .from("studio_asset_upload_sessions")
    .update({ status: "completed", completed_at: now })
    .eq("id", session.id);

  return asset;
}
