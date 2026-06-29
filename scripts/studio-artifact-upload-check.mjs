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

assert.match(assetSource, /downloadRemoteStudioVideoArtifact/, "Artifact ingest must expose server-side remote download helper.");
assert.match(assetSource, /response\.body\.getReader\(\)/, "Artifact download must read the remote video stream.");
assert.match(assetSource, /createHash\("sha256"\)/, "Artifact download must compute sha256.");
assert.match(assetSource, /\.from\("studio_assets"\)[\s\S]*\.insert\(assetRow\)/, "Artifact upload must create studio_assets rows.");
assert.match(assetSource, /\.from\(studioAssetBucket\(\)\)[\s\S]*\.upload\(storageKey/, "Artifact upload must write to Supabase Storage.");
assert.match(dispatcherSource, /uploadCompletedStudioVideoFromRemote/, "Dispatcher must upload completed Hermes renders.");
assert.match(dispatcherSource, /outputAssetIds: uploadedAsset/, "Dispatcher must link uploaded asset IDs to completed jobs.");
assert.match(dispatcherSource, /upload_failed/, "Dispatcher must preserve remote fallback when upload fails.");
assert.match(uiSource, /productAssetUrl \?\? remoteRenderUrl/, "UI must prefer Product-owned asset playback over remote URL.");
assert.match(previewRouteSource, /getStudioAssetPlaybackUrl/, "Preview route must resolve Product-owned asset playback server-side.");

for (const source of [assetSource, dispatcherSource, uiSource, previewRouteSource]) {
  assert.doesNotMatch(source, /CMO_HERMES_VIDEO_AGENT_API_KEY|API_SERVER_KEY/, "Studio artifact code must not expose server API keys.");
  assert.doesNotMatch(source, /\/agents\/studio|\/apps\/\[appId\]\/studio/, "Studio artifact code must not introduce forbidden routes.");
}

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": resolve(root, "src"), "server-only": resolve(root, "scripts/server-only-noop.cjs") },
});
const { downloadRemoteStudioVideoArtifact } = await jiti.import(resolve(root, "src/lib/cmo/studio-asset-ingest.ts"));
const originalFetch = globalThis.fetch;
const bytes = Buffer.from("studio-artifact-upload-smoke-mp4");
const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

try {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://cdn.example.com/render.mp4");
    return new Response(bytes, {
      status: 200,
      headers: { "Content-Type": "video/mp4" },
    });
  };

  const artifact = await downloadRemoteStudioVideoArtifact({
    renderUrl: "https://cdn.example.com/render.mp4",
    maxBytes: 1024 * 1024,
  });

  assert.equal(artifact.bytes, bytes.byteLength);
  assert.equal(artifact.sha256, expectedSha256);
  assert.equal(artifact.mimeType, "video/mp4");
  assert.equal(Buffer.compare(artifact.buffer, bytes), 0);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Studio artifact upload check passed.");
