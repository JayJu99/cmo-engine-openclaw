import { uploadCmoCreativeArtifact } from "@/lib/cmo/creative-assets";
import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import { cmoErrorResponse } from "@/lib/cmo/errors";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function creativeIngestKeyResponse(request: Request): Response | null {
  const expectedKey = (process.env.CMO_CREATIVE_INGEST_API_KEY || process.env.CMO_VAULT_INGEST_API_KEY || "").trim();
  const providedKey = request.headers.get("x-cmo-creative-ingest-key")?.trim() ?? "";
  const isProduction = process.env.NODE_ENV === "production";

  if (!expectedKey) {
    if (isProduction) {
      return Response.json(
        {
          error: "CMO_CREATIVE_INGEST_API_KEY is required before creative artifact ingestion can write in production.",
          code: "creative_ingest_key_not_configured",
        },
        { status: 503 },
      );
    }

    return null;
  }

  if (providedKey !== expectedKey) {
    return Response.json(
      {
        error: "Invalid creative ingest key.",
        code: "creative_ingest_unauthorized",
      },
      { status: 401 },
    );
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function metadataFromForm(form: FormData): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const metadataRaw = form.get("metadata");
  const metadataJsonRaw = form.get("metadata_json");

  for (const raw of [metadataRaw, metadataJsonRaw]) {
    if (typeof raw !== "string" || !raw.trim()) {
      continue;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed)) {
      throw new Error("metadata must be a JSON object.");
    }

    Object.assign(metadata, parsed);
  }

  for (const key of [
    "workspace_id",
    "workspaceId",
    "app_id",
    "appId",
    "request_id",
    "requestId",
    "asset_id",
    "assetId",
    "sha256",
    "bytes",
    "mime_type",
    "mimeType",
    "type",
    "provider",
    "model",
    "operation",
    "prompt_used",
    "promptUsed",
    "visual_summary",
    "visualSummary",
    "width",
    "height",
    "job_id",
    "jobId",
    "path",
    "source_local_path",
  ]) {
    const value = form.get(key);

    if (typeof value === "string" && value.trim()) {
      metadata[key] = value.trim();
    }
  }

  for (const key of ["bytes", "width", "height"]) {
    if (typeof metadata[key] === "string") {
      const parsed = Number.parseInt(metadata[key], 10);

      if (Number.isFinite(parsed)) {
        metadata[key] = parsed;
      }
    }
  }

  return metadata;
}

function fileFromBase64(input: {
  base64: string;
  filename: string;
  mimeType: string;
}): File {
  const bytes = Buffer.from(input.base64, "base64");
  const blob = new Blob([bytes], { type: input.mimeType || "application/octet-stream" });

  return new File([blob], input.filename || "creative-asset.bin", { type: input.mimeType || "application/octet-stream" });
}

async function readIngestPayload(request: Request): Promise<{ file: File; metadata: Record<string, unknown>; workspaceId?: string; jobId?: string }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new Error("file is required.");
    }

    const metadata = metadataFromForm(form);

    return {
      file,
      metadata,
      workspaceId: stringValue(form.get("workspace_id") || form.get("workspaceId") || metadata.workspace_id || metadata.workspaceId),
      jobId: stringValue(form.get("jobId") || metadata.job_id || metadata.jobId),
    };
  }

  const json = await request.json() as unknown;

  if (!isRecord(json)) {
    throw new Error("Creative artifact ingest body must be an object.");
  }

  const metadata = {
    ...(isRecord(json.metadata) ? json.metadata : {}),
    ...(isRecord(json.metadata_json) ? json.metadata_json : {}),
  };
  const base64 = stringValue(json.bytesBase64 ?? json.bytes_base64);

  if (!base64) {
    throw new Error("bytesBase64 is required for JSON creative artifact ingest.");
  }

  return {
    file: fileFromBase64({
      base64,
      filename: stringValue(json.filename) || "creative-asset.png",
      mimeType: stringValue(json.mimeType ?? json.mime_type) || "image/png",
    }),
    metadata,
    workspaceId: stringValue(json.workspaceId ?? json.workspace_id),
    jobId: stringValue(json.jobId ?? json.job_id ?? metadata.job_id ?? metadata.jobId),
  };
}

export async function POST(request: Request, context: { params: Promise<{ appId: string }> }) {
  const authResponse = creativeIngestKeyResponse(request);

  if (authResponse) {
    return authResponse;
  }

  try {
    const { appId } = await context.params;
    const app = getAppWorkspace(appId);

    if (!app) {
      return Response.json(
        {
          error: `Unknown appId: ${appId}`,
          code: "creative_ingest_unknown_app",
        },
        { status: 404 },
      );
    }

    const registryEntry = requireWorkspaceRegistryEntry(app.id);
    const payload = await readIngestPayload(request);
    const payloadAppId = stringValue(payload.metadata.app_id ?? payload.metadata.appId);

    if (payloadAppId && payloadAppId !== app.id) {
      return Response.json(
        {
          error: `Unsupported appId: ${payloadAppId}`,
          code: "creative_ingest_unsupported_app",
        },
        { status: 400 },
      );
    }

    const legacyHoldstationMiniAppScope =
      app.id === "holdstation-mini-app" && payload.workspaceId === registryEntry.tenantId;
    const workspaceId = legacyHoldstationMiniAppScope
      ? registryEntry.workspaceId
      : payload.workspaceId || registryEntry.workspaceId;

    if (workspaceId !== registryEntry.workspaceId) {
      return Response.json(
        {
          error: `Unsupported workspaceId: ${workspaceId}`,
          code: "creative_ingest_unsupported_workspace",
        },
        { status: 400 },
      );
    }

    const asset = await uploadCmoCreativeArtifact({
      file: payload.file,
      metadata: payload.metadata,
      tenantId: registryEntry.tenantId,
      workspaceId,
      appId: app.id,
      ...(payload.jobId ? { jobId: payload.jobId } : {}),
    });

    return Response.json({
      status: "stored",
      asset_id: asset.asset_id,
      storage_path: asset.storage_path,
      render_url: asset.render_url ?? asset.preview_url ?? asset.signed_url,
      signed_url: asset.signed_url ?? asset.preview_url ?? asset.render_url,
      bytes: asset.bytes,
      sha256: asset.sha256,
      mime_type: asset.mime_type,
      transport_status: asset.transport_status,
      data: asset,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: "Invalid creative artifact ingest JSON.",
          code: "creative_ingest_invalid_json",
        },
        { status: 400 },
      );
    }

    return cmoErrorResponse(error);
  }
}
