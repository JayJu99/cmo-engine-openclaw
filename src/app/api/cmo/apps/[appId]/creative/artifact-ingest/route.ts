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
    const metadataRaw = form.get("metadata");

    if (!(file instanceof File)) {
      throw new Error("file is required.");
    }

    const metadata = typeof metadataRaw === "string" && metadataRaw.trim()
      ? JSON.parse(metadataRaw) as unknown
      : {};

    if (!isRecord(metadata)) {
      throw new Error("metadata must be a JSON object.");
    }

    return {
      file,
      metadata,
      workspaceId: stringValue(form.get("workspaceId")),
      jobId: stringValue(form.get("jobId") || metadata.job_id || metadata.jobId),
    };
  }

  const json = await request.json() as unknown;

  if (!isRecord(json)) {
    throw new Error("Creative artifact ingest body must be an object.");
  }

  const metadata = isRecord(json.metadata) ? json.metadata : {};
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

    return Response.json({ data: asset }, { status: 201 });
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
