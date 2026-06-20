import "server-only";

import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import { requireRequestUserIfAuthRequired } from "@/lib/cmo/auth";
import {
  cmoCreativeAssetDownloadFilename,
  downloadCmoCreativeStoredAsset,
  getCmoCreativeStoredAsset,
  type CmoCreativeStoredAsset,
} from "@/lib/cmo/creative-assets";
import { CmoAdapterError } from "@/lib/cmo/errors";
import { requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

function quotedHeaderValue(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
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
  appId: string;
  assetId: string;
  mode: "preview" | "download";
}): Promise<Response> {
  try {
    await requireRequestUserIfAuthRequired();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Authentication required")) {
      throw new CmoAdapterError("Authentication required.", 401, "authentication_required");
    }

    throw error;
  }

  const app = getAppWorkspace(input.appId);

  if (!app) {
    throw new CmoAdapterError(`Unknown appId: ${input.appId}`, 404, "creative_asset_unknown_app");
  }

  const registryEntry = requireWorkspaceRegistryEntry(app.id);
  const asset = await getCmoCreativeStoredAsset({
    tenantId: registryEntry.tenantId,
    workspaceId: registryEntry.workspaceId,
    appId: app.id,
    assetId: input.assetId,
  });

  if (!asset) {
    throw new CmoAdapterError("Creative asset was not found.", 404, "creative_asset_not_found");
  }

  const blob = await downloadCmoCreativeStoredAsset(asset);

  return new Response(blob, {
    status: 200,
    headers: creativeAssetHeaders(asset, blob, input.mode),
  });
}
