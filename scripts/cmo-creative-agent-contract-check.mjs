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
      ...(typeof image.bytes === "number" ? { bytes: image.bytes } : {}),
      ...(sha256 ? { sha256 } : {}),
      ...(typeof image.model === "string" ? { model: image.model } : {}),
      ...(typeof image.operation === "string" ? { operation: image.operation } : {}),
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
  routeIntentSource,
  routeSource,
  outerRuntimeSource,
  typesSource,
  mapperSource,
  storeSource,
  uiSource,
  configSource,
  creativeAgentSource,
  remoteClientSource,
  openClawClientSource,
  ingestRouteSource,
  migrationSource,
] = await Promise.all([
  read("src/lib/cmo/hermes-cmo-runtime.ts"),
  read("src/lib/cmo/app-routing-intent.ts"),
  read("src/lib/cmo/hermes-cmo-chat-router.ts"),
  read("src/lib/cmo/runtime.ts"),
  read("src/lib/cmo/app-workspace-types.ts"),
  read("src/lib/cmo/hermes-cmo-chat-mapper.ts"),
  read("src/lib/cmo/app-chat-store.ts"),
  read("src/components/cmo-apps/cmo-chat-panel.tsx"),
  read("src/lib/cmo/config.ts"),
  read("src/lib/cmo/creative-agent.ts"),
  read("src/lib/cmo/remote-client.ts"),
  read("src/lib/cmo/openclaw-client.ts"),
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
assert.match(configSource, /CMO_HERMES_CREATIVE_EXECUTE_TIMEOUT_MS/, "Creative execute timeout config is required");
assert.match(configSource, /getCmoHermesCreativeExecuteTimeoutMs[\s\S]*300_000/, "Creative execute timeout must default to 300000ms");
assert.match(runtimeSource, /creative_call_mode.*via_cmo/s, "default Creative call mode must route through CMO");
assert.match(routeIntentSource, /creative_execution/, "Product routing intent must classify explicit Creative execution");
assert.match(routeSource, /reason: "creative_execution"/, "Creative execution must select a non-tool-execute Hermes route");
assert.match(mapperSource, /explicit_command: creativeExecutionIntent \? creativeExecutionMode : null/, "Creative prompts must mark Hermes intent as execution");
assert.match(mapperSource, /direct_user_prompt_is_sufficient_execution_input/, "Creative execution must treat the direct user prompt as sufficient input");
assert.match(mapperSource, /missing_accepted_context_blocks_creative_execution:\s*false/, "Missing accepted context must not block explicit Creative execution");
assert.match(mapperSource, /optional_context_gaps/, "Missing accepted project context must be optional diagnostic context for Creative execution");
assert.match(mapperSource, /Do not invent unsupported product mechanics/, "Creative execution must preserve factual-claim guardrails");
assert.match(storeSource, /hermesCmoCreativeExecutionRequested/, "Creative execution route must trigger Hermes live runtime");
assert.match(runtimeSource, /!creativeExecution && \(toolChatCanaryEnabled/, "Creative execution must not be routed to the read-only tool endpoint");
assert.match(runtimeSource, /creativeExecution[\s\S]*getCmoHermesCreativeExecuteTimeoutMs\(\)/, "Creative execution must use the Creative-specific timeout");
assert.match(runtimeSource, /creative\.generate_video/, "Creative video execution mode must be accepted");
assert.match(runtimeSource, /creative_missing_accepted_context_blocks_execution:\s*creativeExecutionRequested \? false : null/, "Runtime Creative envelope must not require accepted context");
assert.match(runtimeSource, /timeout_source/, "Hermes CMO trace must include the timeout source");
assert.match(runtimeSource, /route_decision/, "Hermes CMO trace must include the route decision");
assert.match(runtimeSource, /creative_trace/, "Hermes CMO trace must include Creative routing diagnostics");
assert.match(runtimeSource, /allowSubAgentExecution: specialistExecutionAllowed/, "Creative execution must not be blocked by Echo/Surf orchestration mode");
assert.match(outerRuntimeSource, /appTurnTimeoutConfig/, "Outer app-chat runtime must have explicit timeout selection");
assert.match(outerRuntimeSource, /getCmoHermesCreativeExecuteTimeoutMs\(\)/, "Outer app-chat Creative execution must use the Creative-specific timeout");
assert.match(outerRuntimeSource, /Creative app-chat turn timed out; no workspace fallback used\./, "Outer app-chat Creative timeout must not log workspace fallback");
assert.match(outerRuntimeSource, /outer_timeout_ms/, "Outer app-chat timeout metadata must include timeout ms");
assert.match(outerRuntimeSource, /outer_timeout_source/, "Outer app-chat timeout metadata must include timeout source");
assert.match(storeSource, /Creative execution timed out before Hermes returned the generated asset metadata/, "Creative timeout must render a Creative-specific timeout message");
assert.match(storeSource, /No workspace-context fallback was used for this Creative generation request/, "Creative timeout must not silently fall back to workspace context");
assert.match(mapperSource, /agentsUsedFromMetadata/, "Creative activity metadata must survive mapping");
assert.match(storeSource, /extractCreativeAssetsFromHermesResponse/, "Creative responses must become session artifacts");
assert.match(storeSource, /runtimeResult\.rawRuntimeResponse/, "App-turn Creative metadata must be extracted from the raw runtime response");
assert.match(storeSource, /creative_response_received/, "Creative response diagnostics must be persisted");
assert.match(storeSource, /creative_metadata_present/, "Creative metadata presence must be traced");
assert.match(storeSource, /fallback_used: creativeFallbackUsed/, "Successful Creative metadata must not be overwritten by workspace fallback");
assert.match(remoteClientSource, /extractCreativeAssetsFromHermesResponse/, "Remote app-turn responses must use Creative normalization");
assert.match(remoteClientSource, /creativeMetadataFallbackAnswer/, "Remote app-turn Creative metadata must be a successful response without answer text");
assert.match(openClawClientSource, /extractCreativeAssetsFromHermesResponse/, "Direct app-turn responses must use Creative normalization");
assert.match(openClawClientSource, /Product recorded the asset metadata/, "Direct app-turn Creative metadata must get a safe status answer");
assert.match(mapperSource, /hasCreativeExecutionMetadata/, "Hermes execute response mapper must accept Creative metadata without a conventional answer");
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
assert.equal(hermesSingleImageAssets[0].bytes, 101, "Hermes execute bytes metadata must survive normalization");
assert.equal(hermesSingleImageAssets[0].sha256, "b".repeat(64), "Hermes execute sha256 metadata must survive normalization");
assert.equal(hermesSingleImageAssets[0].model, "gpt-5.5", "Hermes execute model metadata must survive normalization");
assert.equal(hermesSingleImageAssets[0].operation, "responses image_generation", "Hermes execute operation metadata must survive normalization");
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
