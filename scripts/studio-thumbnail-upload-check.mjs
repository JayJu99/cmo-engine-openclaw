import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const root = process.cwd();
const assetSource = readFileSync("src/lib/cmo/studio-asset-ingest.ts", "utf8");
const dispatcherSource = readFileSync("src/lib/cmo/studio-dispatcher.ts", "utf8");
const uiSource = readFileSync("src/components/cmo-apps/studio-view.tsx", "utf8");
const previewRouteSource = readFileSync("src/app/api/cmo/studio/assets/[assetId]/preview/route.ts", "utf8");

assert.match(assetSource, /downloadRemoteStudioThumbnailArtifact/, "Asset ingest must download provider thumbnails server-side.");
assert.match(assetSource, /thumbnail_storage_key/, "Video asset metadata must store Product-owned thumbnail storage key.");
assert.match(assetSource, /thumbnail_mime_type/, "Video asset metadata must store thumbnail MIME type.");
assert.match(assetSource, /thumbnail_bytes/, "Video asset metadata must store thumbnail byte count.");
assert.match(assetSource, /thumbnail_sha256/, "Video asset metadata must store thumbnail sha256.");
assert.match(assetSource, /provider_original_thumbnail_url/, "Video asset metadata must preserve provider thumbnail URL.");
assert.match(assetSource, /thumbnail_upload_status: "upload_failed"/, "Thumbnail upload failure must be recorded without failing the video asset.");
assert.match(assetSource, /preview\?kind=thumbnail/, "Product-owned thumbnail preview route must be stored.");
assert.match(previewRouteSource, /kind.*thumbnail/, "Preview route must support thumbnail playback.");
assert.match(dispatcherSource, /thumbnail_asset_url/, "Dispatcher diagnostics must persist Product-owned thumbnail URL.");
assert.match(dispatcherSource, /thumbnail_upload_status/, "Dispatcher diagnostics must persist thumbnail upload status.");
assert.match(uiSource, /thumbnail_asset_url/, "Studio UI must prefer Product-owned thumbnail URLs.");
assert.match(uiSource, /Product-owned thumbnail/, "Studio UI must label Product-owned thumbnails.");
assert.doesNotMatch(assetSource + dispatcherSource + uiSource, /CMO_HERMES_VIDEO_AGENT_API_KEY|API_SERVER_KEY/, "Thumbnail code must not expose server secrets.");

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": resolve(root, "src"), "server-only": resolve(root, "scripts/server-only-noop.cjs") },
});
const { downloadRemoteStudioThumbnailArtifact } = await jiti.import(resolve(root, "src/lib/cmo/studio-asset-ingest.ts"));
const originalFetch = globalThis.fetch;
const bytes = Buffer.from("studio-thumbnail-upload-smoke-webp");
const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

try {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://cdn.example.com/thumb.webp");
    return new Response(bytes, {
      status: 200,
      headers: { "Content-Type": "image/webp" },
    });
  };

  const artifact = await downloadRemoteStudioThumbnailArtifact({
    thumbnailUrl: "https://cdn.example.com/thumb.webp",
    maxBytes: 1024 * 1024,
  });

  assert.equal(artifact.bytes, bytes.byteLength);
  assert.equal(artifact.sha256, expectedSha256);
  assert.equal(artifact.mimeType, "image/webp");
  assert.equal(Buffer.compare(artifact.buffer, bytes), 0);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Studio thumbnail upload check passed.");
