import "server-only";

import { createHash, timingSafeEqual } from "crypto";

import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import { requireCurrentUser, requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import { getCmoCreativeArtifactReadKey } from "@/lib/cmo/config";
import {
  CMO_CREATIVE_ALLOWED_MIME_TYPES,
  cmoCreativeAssetDownloadFilename,
  downloadCmoCreativeStoredAsset,
  getCmoCreativeStoredAsset,
  type CmoCreativeStoredAsset,
} from "@/lib/cmo/creative-assets";
import { isSyntheticCreativeAssetId } from "@/lib/cmo/creative-draft-state";
import { CmoAdapterError } from "@/lib/cmo/errors";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";
import { isCmoAuthEnabled } from "@/lib/supabase/config";

const CMO_CREATIVE_ARTIFACT_READ_HEADER = "x-cmo-creative-artifact-key";
const STORED_ASSET_STATUSES = new Set(["stored", "uploaded"]);
const ALLOWED_MIME_TYPES = new Set<string>(CMO_CREATIVE_ALLOWED_MIME_TYPES);

function quotedHeaderValue(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
}

function constantTimeEquals(a: string, b: string): boolean {
  const aHash = createHash("sha256").update(a).digest();
  const bHash = createHash("sha256").update(b).digest();

  return timingSafeEqual(aHash, bHash);
}

async function requireCreativeAssetReadAccess(request: Request): Promise<{
  s2sEnabled: boolean;
  s2sAuthUsed: boolean;
  s2sAuthValid: boolean;
}> {
  const expectedKey = getCmoCreativeArtifactReadKey();
  const providedKey = request.headers.get(CMO_CREATIVE_ARTIFACT_READ_HEADER)?.trim() ?? "";

  if (providedKey) {
    const valid = Boolean(expectedKey) && constantTimeEquals(providedKey, expectedKey);

    if (!valid) {
      throw new CmoAdapterError("Invalid creative artifact read key.", 401, "creative_artifact_read_unauthorized");
    }

    return {
      s2sEnabled: true,
      s2sAuthUsed: true,
      s2sAuthValid: true,
    };
  }

  try {
    if (isCmoAuthEnabled()) {
      await requireCurrentUser();
    } else {
      await requireRequestUserIfAuthRequired();
    }

    return {
      s2sEnabled: Boolean(expectedKey),
      s2sAuthUsed: false,
      s2sAuthValid: false,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Authentication required")) {
      throw new CmoAdapterError("Authentication required.", 401, "authentication_required");
    }

    throw error;
  }
}

function validateStoredAssetForDownload(asset: CmoCreativeStoredAsset) {
  if (!STORED_ASSET_STATUSES.has(asset.status)) {
    throw new CmoAdapterError("Creative asset is not stored.", 404, "creative_asset_not_stored");
  }

  if (!ALLOWED_MIME_TYPES.has(asset.mimeType)) {
    throw new CmoAdapterError("Creative asset type is not supported.", 415, "creative_asset_unsupported_mime_type");
  }

  if (
    /^(?:file:|[A-Za-z]:[\\/]|\/(?:tmp|var|Users|home|private|Volumes)\b)/i.test(asset.storagePath) ||
    asset.storagePath.includes("[hermes_local_artifact_path_redacted]")
  ) {
    throw new CmoAdapterError("Creative asset storage path is not downloadable.", 404, "creative_asset_storage_path_invalid");
  }
}

function creativeAssetHeaders(asset: CmoCreativeStoredAsset, blob: Blob, mode: "preview" | "download"): Headers {
  const headers = new Headers({
    "Content-Type": asset.mimeType || blob.type || "application/octet-stream",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  const contentLength = asset.bytes ?? blob.size;

  if (Number.isFinite(contentLength) && contentLength > 0) {
    headers.set("Content-Length", String(Math.floor(contentLength)));
  }

  if (asset.sha256) {
    headers.set("ETag", `"${asset.sha256}"`);
  }

  if (mode === "download") {
    const filename = cmoCreativeAssetDownloadFilename(asset);
    headers.set("Content-Disposition", `attachment; filename="${quotedHeaderValue(filename)}"`);
  }

  return headers;
}

export async function cmoCreativeAssetResponse(input: {
  request: Request;
  appId: string;
  assetId: string;
  mode: "preview" | "download";
}): Promise<Response> {
  const authDiagnostics = await requireCreativeAssetReadAccess(input.request);

  const app = getAppWorkspace(input.appId);

  if (!app) {
    throw new CmoAdapterError(`Unknown appId: ${input.appId}`, 404, "creative_asset_unknown_app");
  }

  const registryEntry = requireWorkspaceRegistryEntry(app.id);

  if (isSyntheticCreativeAssetId(input.assetId)) {
    throw new CmoAdapterError("Creative asset is not renderable.", 404, "creative_asset_not_renderable");
  }

  const asset = await getCmoCreativeStoredAsset({
    tenantId: registryEntry.tenantId,
    workspaceId: registryEntry.workspaceId,
    appId: app.id,
    assetId: input.assetId,
  });

  if (!asset) {
    throw new CmoAdapterError("Creative asset was not found.", 404, "creative_asset_not_found");
  }

  validateStoredAssetForDownload(asset);

  const blob = await downloadCmoCreativeStoredAsset(asset);

  if (input.mode === "download") {
    console.info("[cmo-creative-asset-download]", {
      appId: app.id,
      assetId: input.assetId,
      s2s_artifact_download_enabled: authDiagnostics.s2sEnabled,
      s2s_artifact_download_auth_used: authDiagnostics.s2sAuthUsed,
      s2s_artifact_download_auth_valid: authDiagnostics.s2sAuthValid,
      s2s_artifact_download_http_status: 200,
    });
  }

  return new Response(blob, {
    status: 200,
    headers: creativeAssetHeaders(asset, blob, input.mode),
  });
}
