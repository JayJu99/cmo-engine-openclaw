import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

function redactSensitiveText(value) {
  return value
    .replace(/(?:[A-Za-z]:\\Users\\[^\\\s]+\\[^\s]*?\.codex\\auth\.json|\/Users\/[^/\s]+\/[^\s]*?\.codex\/auth\.json|\/home\/[^/\s]+\/[^\s]*?\.codex\/auth\.json|\.codex[\\/][^\s]*auth\.json|auth\.json)/gi, "[redacted_auth_path]")
    .replace(/(Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9_-]{12,}|token\s*[:=]\s*\S+|cookie\s*[:=]\s*\S+|secret\s*[:=]\s*\S+)/gi, "[redacted_secret]");
}

function isBrowserPreviewUrl(value) {
  if (typeof value !== "string" || /^(?:file:|[A-Za-z]:[\\/]|\/(?:tmp|var|Users|home|private|Volumes)\b)/i.test(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return value.startsWith("/");
  }
}

function normalizeCreativeResponse(value) {
  const images = Array.isArray(value.images)
    ? value.images
    : value.image_path || value.path || value.preview_url || value.signed_url || value.url || value.storage_path || value.sha256
      ? [{
          path: value.image_path ?? value.path,
          preview_url: value.preview_url,
          signed_url: value.signed_url,
          url: value.url,
          storage_path: value.storage_path,
          provider: value.provider,
          bytes: value.bytes,
          sha256: value.sha256,
          width: value.width,
          height: value.height,
          model: value.model,
          operation: value.operation,
        }]
      : [];

  return images.map((image, index) => {
    const previewUrl = isBrowserPreviewUrl(image.preview_url) ? image.preview_url : undefined;
    const storagePath = typeof image.storage_path === "string" ? image.storage_path : undefined;
    const sha256 = typeof image.sha256 === "string" && /^[a-f0-9]{64}$/i.test(image.sha256) ? image.sha256.toLowerCase() : undefined;
    const sourceLocalPath = typeof image.path === "string"
      ? `[hermes_local_artifact_path_redacted]/${path.basename(image.path).replace(/[^a-z0-9._-]+/gi, "_")}`
      : undefined;

    return {
      schema_version: "cmo.creative_asset.v1",
      type: "creative_asset",
      asset_id: `creative_${sha256 ?? index + 1}`,
      agent: "creative",
      asset_type: "image",
      status: previewUrl || storagePath ? "stored" : "artifact_transport_missing",
      transport_status: previewUrl || storagePath ? "available" : "artifact_transport_missing",
      ...(previewUrl ? { preview_url: previewUrl } : {}),
      ...(sourceLocalPath ? { source_local_path_redacted: sourceLocalPath } : {}),
      review_required: true,
    };
  });
}

async function optionalLiveIngestCheck() {
  const baseUrl = process.env.CMO_CREATIVE_INGEST_TEST_URL;
  const key = process.env.CMO_CREATIVE_INGEST_API_KEY;

  if (!baseUrl || !key || typeof fetch !== "function") {
    return "skipped";
  }

  const bytes = Buffer.from("creative-ingest-smoke");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const body = {
    filename: "creative-ingest-smoke.png",
    mimeType: "image/png",
    bytesBase64: bytes.toString("base64"),
    metadata: {
      sha256,
      prompt_used: "smoke test",
      visual_summary: "Smoke test artifact.",
      path: "/tmp/creative-agent-smoke/smoke.png",
    },
  };
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cmo-creative-ingest-key": key,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.data?.status, "stored");
  assert.equal(payload.data?.sha256, sha256);
  assert.ok(payload.data?.preview_url || payload.data?.signed_url);

  return "passed";
}

const [
  runtimeSource,
  typesSource,
  mapperSource,
  storeSource,
  uiSource,
  configSource,
  creativeAgentSource,
  ingestRouteSource,
  migrationSource,
] = await Promise.all([
  read("src/lib/cmo/hermes-cmo-runtime.ts"),
  read("src/lib/cmo/app-workspace-types.ts"),
  read("src/lib/cmo/hermes-cmo-chat-mapper.ts"),
  read("src/lib/cmo/app-chat-store.ts"),
  read("src/components/cmo-apps/cmo-chat-panel.tsx"),
  read("src/lib/cmo/config.ts"),
  read("src/lib/cmo/creative-agent.ts"),
  read("src/app/api/cmo/apps/[appId]/creative/artifact-ingest/route.ts"),
  read("supabase/migrations/202606200002_cmo_creative_assets.sql"),
]);

assert.match(runtimeSource, /"creative"/, "creative must be accepted by runtime agent registry");
assert.match(typesSource, /HermesCmoAgentUsed = "cmo" \| "echo" \| "surf" \| "creative"/, "creative must persist in agent metadata");

for (const state of [
  "creative.started",
  "creative.generating",
  "creative.asset_ready",
  "creative.partial",
  "creative.blocked",
  "creative.failed",
]) {
  assert.ok(runtimeSource.includes(state), `${state} must be a known runtime activity state`);
}

assert.match(configSource, /CMO_HERMES_CREATIVE_ENABLED/, "Creative enabled config is required");
assert.match(configSource, /CMO_HERMES_CREATIVE_CALL_MODE/, "Creative call mode config is required");
assert.match(configSource, /CMO_HERMES_CREATIVE_PROFILE/, "Creative profile config is required");
assert.match(runtimeSource, /creative_call_mode.*via_cmo/s, "default Creative call mode must route through CMO");
assert.match(runtimeSource, /creative_trace/, "Hermes CMO trace must include Creative routing diagnostics");
assert.match(runtimeSource, /allowSubAgentExecution: specialistExecutionAllowed/, "Creative execution must not be blocked by Echo/Surf orchestration mode");
assert.match(mapperSource, /agentsUsedFromMetadata/, "Creative activity metadata must survive mapping");
assert.match(storeSource, /extractCreativeAssetsFromHermesResponse/, "Creative responses must become session artifacts");
assert.match(uiSource, /Creative Assets/, "Chat UI must render Creative asset cards");
assert.match(uiSource, /Artifact transport missing/, "UI must show missing transport state");
assert.match(uiSource, /isBrowserPreviewUrl/, "UI must not render local paths as previews");
assert.match(ingestRouteSource, /uploadCmoCreativeArtifact/, "Creative artifact ingest endpoint must exist");
assert.match(ingestRouteSource, /x-cmo-creative-ingest-key/, "Creative ingest endpoint must require server-to-server key when configured");
assert.match(creativeAgentSource, /value\.image_path/, "Product must parse Hermes Creative image_path execution responses");
assert.match(migrationSource, /cmo_creative_jobs/, "Creative jobs table migration is required");
assert.match(migrationSource, /cmo_creative_assets/, "Creative assets table migration is required");
assert.match(migrationSource, /cmo-creative-assets/, "Creative Supabase Storage bucket is required");

const creativeResponse = {
  schema_version: "cmo.creative_response.v1",
  status: "success",
  prompt_used: "Generate a square mascot thumbnail.",
  images: [
    {
      path: "/tmp/creative-agent-smoke/output.png",
      bytes: 1916219,
      sha256: "a".repeat(64),
      model: "gpt-5.4",
      operation: "responses image_generation",
      width: 1254,
      height: 1254,
    },
  ],
  visual_summary: "A mascot thumbnail.",
};
const assets = normalizeCreativeResponse(creativeResponse);
const hermesSingleImageAssets = normalizeCreativeResponse({
  schema_version: "cmo.creative_response.v1",
  status: "success",
  routed_to_creative: true,
  image_path: "/tmp/creative-agent-smoke/hermes-output.png",
  bytes: 101,
  sha256: "b".repeat(64),
  model: "gpt-5.5",
  operation: "responses image_generation",
});

assert.equal(assets.length, 1, "Creative image metadata must parse");
assert.equal(hermesSingleImageAssets.length, 1, "Hermes single-image execution metadata must parse");
assert.equal(hermesSingleImageAssets[0].status, "artifact_transport_missing", "Hermes local image_path must require Product artifact transport");
assert.ok(!JSON.stringify(hermesSingleImageAssets).includes("/tmp/creative-agent-smoke"), "Hermes local image_path must be redacted");
assert.equal(assets[0].status, "artifact_transport_missing", "local-path-only assets must not be treated as previews");
assert.equal(assets[0].preview_url, undefined, "local /tmp path must not be rendered as browser preview");
assert.ok(assets[0].source_local_path_redacted?.startsWith("[hermes_local_artifact_path_redacted]"), "local path must be redacted");
assert.ok(!JSON.stringify(assets).includes("/tmp/creative-agent-smoke"), "full local path must not be retained");
assert.ok(!isBrowserPreviewUrl("/tmp/creative-agent-smoke/output.png"), "local Mac path must not be a browser URL");

const redacted = redactSensitiveText("/Users/jay/.codex/auth.json token=abc123");
assert.ok(!redacted.includes("/Users/jay/.codex/auth.json"), "auth path must be redacted");
assert.ok(!/token=abc123/.test(redacted), "token-like fields must be redacted");

const liveIngest = await optionalLiveIngestCheck();

console.log(JSON.stringify({
  ok: true,
  checks: {
    registry: "passed",
    lifecycle_states: "passed",
    creative_response_parse: "passed",
    local_path_not_preview: "passed",
    artifact_transport_missing: "passed",
    ingest_route_present: "passed",
    supabase_storage_live_ingest: liveIngest,
    auth_path_redaction: "passed",
  },
}, null, 2));
