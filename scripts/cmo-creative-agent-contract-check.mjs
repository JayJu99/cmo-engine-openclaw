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

function creativeAssetProxyUrl({ appId, assetId, mode }) {
  return `/api/cmo/apps/${encodeURIComponent(appId)}/creative/assets/${encodeURIComponent(assetId)}/${mode}`;
}

function shouldUseCreativeAssetProxy(asset) {
  const assetId = asset.asset_id || asset.assetId || asset.id;
  const transportStatus = asset.transport_status || asset.transportStatus;

  return Boolean(typeof assetId === "string" && assetId.trim() && transportStatus === "uploaded");
}

function creativeAssetPreviewUrl(asset, appId = "hold-pay") {
  const assetId = asset.asset_id || asset.assetId || asset.id;

  if (typeof assetId === "string" && assetId.trim() && shouldUseCreativeAssetProxy(asset)) {
    return creativeAssetProxyUrl({ appId, assetId, mode: "preview" });
  }

  for (const key of ["signed_url", "signedUrl", "render_url", "renderUrl", "preview_url", "previewUrl"]) {
    if (isBrowserPreviewUrl(asset[key])) {
      return String(asset[key]);
    }
  }

  return "";
}

function creativeAssetDownloadUrl(asset, appId = "hold-pay") {
  const assetId = asset.asset_id || asset.assetId || asset.id;

  if (typeof assetId === "string" && assetId.trim() && shouldUseCreativeAssetProxy(asset)) {
    return creativeAssetProxyUrl({ appId, assetId, mode: "download" });
  }

  return creativeAssetPreviewUrl(asset, appId);
}

function normalizeCreativeResponse(value) {
  const images = Array.isArray(value.creative_assets)
    ? value.creative_assets
    : Array.isArray(value.images)
    ? value.images
    : value.image_path || value.path || value.render_url || value.renderUrl || value.preview_url || value.previewUrl || value.signed_url || value.signedUrl || value.url || value.storage_path || value.storagePath || value.sha256
      ? [{
          path: value.image_path ?? value.path,
          render_url: value.render_url ?? value.renderUrl,
          preview_url: value.preview_url ?? value.previewUrl,
          signed_url: value.signed_url ?? value.signedUrl,
          url: value.url,
          storage_path: value.storage_path ?? value.storagePath,
          asset_id: value.asset_id,
          asset_type: value.asset_type ?? value.assetType,
          transport_status: value.transport_status ?? value.transportStatus,
          provider: value.provider,
          bytes: value.bytes,
          mime_type: value.mime_type ?? value.mimeType,
          sha256: value.sha256,
          width: value.width,
          height: value.height,
          model: value.model,
          operation: value.operation,
        }]
      : [];

  return images.map((image, index) => {
    const previewUrl = isBrowserPreviewUrl(image.signed_url ?? image.signedUrl)
      ? image.signed_url ?? image.signedUrl
      : isBrowserPreviewUrl(image.render_url ?? image.renderUrl)
        ? image.render_url ?? image.renderUrl
        : isBrowserPreviewUrl(image.preview_url ?? image.previewUrl)
          ? image.preview_url ?? image.previewUrl
          : undefined;
    const storagePath = typeof image.storage_path === "string" ? image.storage_path : undefined;
    const sha256 = typeof image.sha256 === "string" && /^[a-f0-9]{64}$/i.test(image.sha256) ? image.sha256.toLowerCase() : undefined;
    const sourceLocalPath = typeof image.path === "string"
      ? `[hermes_local_artifact_path_redacted]/${path.basename(image.path).replace(/[^a-z0-9._-]+/gi, "_")}`
      : undefined;

    return {
      schema_version: "cmo.creative_asset.v1",
      type: "creative_asset",
      asset_id: typeof image.asset_id === "string" ? image.asset_id : `creative_${sha256 ?? index + 1}`,
      agent: "creative",
      asset_type: image.asset_type === "video" ? "video" : "image",
      status: previewUrl || storagePath ? "stored" : "artifact_transport_missing",
      transport_status: image.transport_status === "uploaded" ? "uploaded" : previewUrl || storagePath ? "available" : "artifact_transport_missing",
      ...(previewUrl ? { render_url: previewUrl } : {}),
      ...(previewUrl ? { renderUrl: previewUrl } : {}),
      ...(previewUrl ? { preview_url: previewUrl } : {}),
      ...(previewUrl ? { previewUrl } : {}),
      ...(previewUrl && (image.signed_url === previewUrl || image.signedUrl === previewUrl) ? { signed_url: previewUrl, signedUrl: previewUrl } : {}),
      ...(sourceLocalPath ? { source_local_path_redacted: sourceLocalPath } : {}),
      ...(typeof image.bytes === "number" ? { bytes: image.bytes } : {}),
      ...(typeof image.mime_type === "string" ? { mime_type: image.mime_type } : {}),
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
  chatV11Source,
  storeSource,
  uiSource,
  configSource,
  creativeAgentSource,
  remoteClientSource,
  openClawClientSource,
  ingestRouteSource,
  migrationSource,
  nextConfigSource,
  proxySource,
  creativeAssetsSource,
  creativeAssetResponseSource,
  creativeAssetPreviewRouteSource,
  creativeAssetDownloadRouteSource,
  packageSource,
  envExampleSource,
] = await Promise.all([
  read("src/lib/cmo/hermes-cmo-runtime.ts"),
  read("src/lib/cmo/app-routing-intent.ts"),
  read("src/lib/cmo/hermes-cmo-chat-router.ts"),
  read("src/lib/cmo/runtime.ts"),
  read("src/lib/cmo/app-workspace-types.ts"),
  read("src/lib/cmo/hermes-cmo-chat-mapper.ts"),
  read("src/lib/cmo/hermes-cmo-chat-v11.ts"),
  read("src/lib/cmo/app-chat-store.ts"),
  read("src/components/cmo-apps/cmo-chat-panel.tsx"),
  read("src/lib/cmo/config.ts"),
  read("src/lib/cmo/creative-agent.ts"),
  read("src/lib/cmo/remote-client.ts"),
  read("src/lib/cmo/openclaw-client.ts"),
  read("src/app/api/cmo/apps/[appId]/creative/artifact-ingest/route.ts"),
  read("supabase/migrations/202606200002_cmo_creative_assets.sql"),
  read("next.config.ts"),
  read("src/proxy.ts"),
  read("src/lib/cmo/creative-assets.ts"),
  read("src/lib/cmo/creative-asset-response.ts"),
  read("src/app/api/cmo/apps/[appId]/creative/assets/[assetId]/preview/route.ts"),
  read("src/app/api/cmo/apps/[appId]/creative/assets/[assetId]/download/route.ts"),
  read("package.json"),
  read(".env.example"),
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
assert.match(configSource, /getCmoCreativeArtifactReadKey/, "Creative artifact read key must be server config only");
assert.match(envExampleSource, /CMO_CREATIVE_ARTIFACT_READ_KEY=/, "Creative artifact read key must be documented in env example");
assert.match(envExampleSource, /x-cmo-creative-artifact-key/, "Artifact read env docs must document the internal auth header");
assert.match(configSource, /getCmoHermesCreativeExecuteTimeoutMs[\s\S]*300_000/, "Creative execute timeout must default to 300000ms");
assert.match(runtimeSource, /creative_call_mode.*via_cmo/s, "default Creative call mode must route through CMO");
assert.match(routeIntentSource, /creative_execution/, "Product routing intent must classify explicit Creative execution");
assert.match(routeSource, /reason: "creative_execution"/, "Creative execution must select a non-tool-execute Hermes route");
assert.doesNotMatch(mapperSource, /explicit_command: creativeExecutionIntent \? creativeExecutionMode : null/, "Creative prompts must not mark Hermes intent as Product-owned execution");
assert.match(mapperSource, /creative_decision_context/, "Creative prompts must send CMO-owned decision context");
assert.match(mapperSource, /product_intent_hint: productIntentHint/, "Creative prompts may send non-authoritative Product hints");
assert.match(mapperSource, /sideEffectPolicy: creativeSideEffectPolicy/, "Creative prompts must send side-effect permission separately from action decision");
assert.match(mapperSource, /direct_user_prompt_is_sufficient_execution_input/, "Creative execution must treat the direct user prompt as sufficient input");
assert.match(mapperSource, /missing_accepted_context_blocks_creative_execution:\s*false/, "Missing accepted context must not block explicit Creative execution");
assert.match(mapperSource, /optional_context_gaps/, "Missing accepted project context must be optional diagnostic context for Creative execution");
assert.match(mapperSource, /Do not invent unsupported product mechanics/, "Creative execution must preserve factual-claim guardrails");
assert.match(storeSource, /hermesCmoCreativeExecutionRequested/, "Creative execution route must trigger Hermes live runtime");
assert.match(runtimeSource, /!creativeNativeExecuteEndpoint && \(toolChatCanaryEnabled/, "Creative execution must not be routed to the read-only tool endpoint");
assert.match(runtimeSource, /creativeLongRunningTurn[\s\S]*getCmoHermesCreativeExecuteTimeoutMs\(\)/, "Creative execution/session must use the Creative-specific timeout");
assert.match(runtimeSource, /creative\.generate_video/, "Creative video execution mode must be accepted");
assert.match(runtimeSource, /creative_missing_accepted_context_blocks_execution:\s*creativeExecutionRequested \? false : null/, "Runtime Creative envelope must not require accepted context");
assert.match(runtimeSource, /artifact_transport/, "Creative execution payload must include Product-owned artifact transport");
assert.match(runtimeSource, /mode: "product_upload"/, "Creative artifact transport must request Product upload mode");
assert.match(runtimeSource, /upload_endpoint: `\$\{productPublicOrigin\(\)\}\/api\/cmo\/apps\/\$\{encodeURIComponent\(appId\)\}\/creative\/artifact-ingest`/, "Creative artifact transport must target Product ingest route");
assert.match(runtimeSource, /accepted_mime_types: \[\.\.\.CMO_CREATIVE_ARTIFACT_MIME_TYPES\]/, "Creative artifact transport must declare accepted media types");
assert.match(runtimeSource, /max_bytes: CMO_CREATIVE_ARTIFACT_MAX_BYTES/, "Creative artifact transport must declare Product max bytes");
assert.match(runtimeSource, /maybeNormalizeCreativeExecutionResponseCandidate/, "Creative execution responses must normalize before standard M1 response validation");
assert.match(runtimeSource, /creativeResponseStatuses = new Set\(\["success", "completed", "partial", "blocked", "failed", "timeout"\]\)/, "Creative execution must accept Creative-specific status values");
assert.match(runtimeSource, /creativeResponseHasExecutionMetadata/, "Creative execution validation bypass must require image metadata");
assert.match(runtimeSource, /rejected_by_m1_validator=true/, "Creative validation rejection diagnostics must be traceable");
assert.match(runtimeSource, /safeCreativeSideEffects/, "Creative execution must sanitize safe generation side effects before generic M1 rejection");
assert.match(runtimeSource, /requestIsCreativeExecution\(request\) && creativeMetadataPresent/, "Creative side-effect sanitizer must be scoped to explicit Creative execution with metadata");
assert.match(runtimeSource, /value === false \|\| value === undefined \|\| value === null/, "False/null Creative side-effect flags must be treated as no-op before key rejection");
assert.match(runtimeSource, /executed_creative/, "Explicit Creative execution marker must be allowed only through Creative side-effect normalization");
assert.match(runtimeSource, /sourceModeIsCreativeExecution/, "Creative execution activity source mode must be explicitly scoped");
assert.match(runtimeSource, /creativeLifecycleActivityTypes/, "source.mode=creative_execution must be limited to Creative lifecycle events");
assert.match(runtimeSource, /side_effects_allowed_for_creative/, "Creative side-effect allowance diagnostics must be traced");
assert.match(runtimeSource, /rejected_side_effect_type/, "Rejected Creative side-effect type must be traceable");
assert.match(runtimeSource, /timeout_source/, "Hermes CMO trace must include the timeout source");
assert.match(runtimeSource, /route_decision/, "Hermes CMO trace must include the route decision");
assert.match(runtimeSource, /creative_trace/, "Hermes CMO trace must include Creative routing diagnostics");
assert.match(runtimeSource, /writeHermesTrace\(finalOutboundRequest, "response"[\s\S]*creative_long_running_turn: config\.creativeLongRunningTurn/, "Successful long-running Creative responses must write _response.json traces");
assert.match(runtimeSource, /request\.created_at\.replace\(\/\[:\.\]\/g, "-"\)/, "Hermes CMO runtime request/response trace files must share the request created_at prefix");
assert.match(chatV11Source, /chatTracePrefixes[\s\S]*hermesCmoChatV11TracePrefix\(request\)[\s\S]*_\$\{safeTraceId\(request\.app_id\)\}/, "Hermes CMO chat v1.1 request/response trace files must share a stable request prefix");
assert.match(runtimeSource, /allowSubAgentExecution: specialistExecutionAllowed/, "Creative execution must not be blocked by Echo/Surf orchestration mode");
assert.match(outerRuntimeSource, /appTurnTimeoutConfig/, "Outer app-chat runtime must have explicit timeout selection");
assert.match(outerRuntimeSource, /getCmoHermesCreativeExecuteTimeoutMs\(\)/, "Outer app-chat Creative execution must use the Creative-specific timeout");
assert.match(outerRuntimeSource, /Creative app-chat turn timed out; no workspace fallback used\./, "Outer app-chat Creative timeout must not log workspace fallback");
assert.match(outerRuntimeSource, /outer_timeout_ms/, "Outer app-chat timeout metadata must include timeout ms");
assert.match(outerRuntimeSource, /outer_timeout_source/, "Outer app-chat timeout metadata must include timeout source");
assert.doesNotMatch(storeSource, /Creative execution timed out before Hermes returned the generated asset metadata/, "Creative timeout must not render Product-authored CMO prose");
assert.doesNotMatch(storeSource, /No workspace-context fallback was used for this Creative generation request/, "Creative timeout must not render Product-authored CMO prose");
assert.match(mapperSource, /agentsUsedFromMetadata/, "Creative activity metadata must survive mapping");
assert.match(storeSource, /extractCreativeAssetsFromHermesResponse/, "Creative responses must become session artifacts");
assert.match(storeSource, /sanitizeCreativeAssetStates/, "Creative session state must sanitize Product-backed Creative assets");
assert.match(storeSource, /creativeMissingRenderableAssetWarning/, "Creative execution with metadata but zero renderable assets must show a Creative warning");
assert.match(storeSource, /finalActiveCreativeAssetId/, "Creative persistence must recompute active asset id after artifact normalization");
assert.match(storeSource, /finalCreativeAssetsCount/, "Creative persistence must recompute asset count after artifact normalization");
assert.match(storeSource, /creativeAssets: turnCreativeArtifacts/, "Assistant message must persist canonical Creative assets");
assert.match(storeSource, /creative_assets: turnCreativeArtifacts/, "Assistant message must persist snake_case Creative assets alias");
assert.match(storeSource, /active_asset_id: finalActiveCreativeAssetId/, "Creative metadata must persist final active_asset_id");
assert.match(storeSource, /creative_session_active_asset_id: finalActiveCreativeAssetId/, "Creative metadata must persist final creative_session_active_asset_id");
assert.match(storeSource, /resolvedFinalActiveCreativeAssetId = creativeWorkingState\?\.active_asset_id \?\? finalCanonicalCreativeAssetStates\.at\(-1\)\?\.asset_id/, "Creative active asset must fall back to newest canonical creativeAssets item");
assert.match(storeSource, /active_asset_id: normalizeOptionalString\(message\.active_asset_id\)/, "Message normalization must preserve active_asset_id");
assert.match(storeSource, /active_creative_asset_id: normalizeOptionalString\(message\.active_creative_asset_id\)/, "Message normalization must preserve active_creative_asset_id");
assert.match(storeSource, /runtimeResult\.rawRuntimeResponse/, "App-turn Creative metadata must be extracted from the raw runtime response");
assert.match(storeSource, /creative_response_received/, "Creative response diagnostics must be persisted");
assert.match(storeSource, /creative_metadata_present/, "Creative metadata presence must be traced");
assert.match(storeSource, /rejected_by_m1_validator/, "Creative M1 validation rejection diagnostics must be persisted");
assert.match(storeSource, /side_effects_allowed_for_creative/, "Creative side-effect diagnostics must be persisted");
assert.match(storeSource, /rejected_side_effect_type/, "Rejected Creative side-effect type must be persisted");
assert.match(storeSource, /fallback_used: creativeFallbackUsed/, "Successful Creative metadata must not be overwritten by workspace fallback");
assert.match(remoteClientSource, /extractCreativeAssetsFromHermesResponse/, "Remote app-turn responses must use Creative normalization");
assert.match(remoteClientSource, /creativeNarrativeFromPayload/, "Remote app-turn Creative metadata may use Creative-provided narrative only");
assert.doesNotMatch(remoteClientSource, /creativeMetadataFallbackAnswer/, "Remote app-turn Creative metadata must not synthesize Product answer copy");
assert.match(openClawClientSource, /extractCreativeAssetsFromHermesResponse/, "Direct app-turn responses must use Creative normalization");
assert.match(openClawClientSource, /creativeNarrativeFromPayload/, "Direct app-turn Creative metadata may use Creative-provided narrative only");
assert.doesNotMatch(openClawClientSource, /Product recorded the asset metadata/, "Direct app-turn Creative metadata must not synthesize Product answer copy");
assert.match(mapperSource, /hasCreativeExecutionMetadata/, "Hermes execute response mapper must accept Creative metadata without a conventional answer");
assert.match(mapperSource, /creativeNarrativeFromHermes/, "Hermes execute response mapper may use Hermes or Creative narrative only");
assert.doesNotMatch(mapperSource, /Creative execution completed and returned generated asset metadata/, "Hermes execute response mapper must not synthesize Product Creative answer copy");
assert.match(mapperSource, /CMO_CREATIVE_ARTIFACT_AUTH_REF = "cmo_creative_artifact_read_key"/, "Reference assets must use symbolic artifact auth_ref");
assert.match(mapperSource, /CMO_CREATIVE_ARTIFACT_AUTH_HEADER = "x-cmo-creative-artifact-key"/, "Reference assets must declare the artifact read auth header");
assert.match(mapperSource, /fetch_url: creativeAssetDownloadFetchUrl\(appId, activeAsset\.asset_id\)/, "Reference assets must include snake_case absolute Product fetch URL");
assert.match(mapperSource, /fetchUrl/, "Reference assets must include camelCase absolute Product fetch URL");
assert.match(mapperSource, /auth_ref: CMO_CREATIVE_ARTIFACT_AUTH_REF/, "Reference assets must include auth_ref without raw secret");
assert.match(mapperSource, /auth_header: CMO_CREATIVE_ARTIFACT_AUTH_HEADER/, "Reference assets must include auth_header without raw secret");
assert.doesNotMatch(mapperSource, /CMO_CREATIVE_ARTIFACT_READ_KEY/, "Mapper must not read or embed raw artifact read key");
assert.match(uiSource, /Creative Assets/, "Chat UI must render Creative asset cards");
assert.match(uiSource, /isProductBackedRenderableCreativeAsset/, "Chat UI must render only Product-backed Creative asset cards");
assert.match(uiSource, /Artifact transport missing/, "UI must show missing transport state");
assert.match(uiSource, /creativeAssetPreviewUrl/, "UI must resolve Creative preview URLs through a single safe helper");
assert.match(uiSource, /\["signed_url", "signedUrl", "render_url", "renderUrl", "preview_url", "previewUrl"\]/, "UI preview resolver must prefer signed URL before render URL");
assert.match(uiSource, /<img[\s\S]*src=\{previewUrl\}/, "Creative image preview img src must use the resolved signed/render URL");
assert.match(uiSource, /creativeAssetPreviewFrameStyle/, "Creative preview frame must be aspect-aware");
assert.match(uiSource, /naturalWidth[\s\S]*naturalHeight/, "Creative image preview must fall back to natural image dimensions");
assert.match(uiSource, /className="size-full object-contain"/, "Creative image preview must contain rather than crop assets");
assert.doesNotMatch(uiSource, /aspect-square bg-white/, "Creative asset preview must not force a square crop frame");
assert.doesNotMatch(uiSource, /className="size-full object-cover"/, "Creative asset preview must not crop with object-cover");
assert.match(uiSource, /creativeAssetProxyUrl/, "Uploaded Creative assets must use Product-owned same-origin asset proxy URLs");
assert.match(uiSource, /\/api\/cmo\/apps\/\$\{encodeURIComponent\(input\.appId\)\}\/creative\/assets\/\$\{encodeURIComponent\(input\.assetId\)\}\/\$\{input\.mode\}/, "Creative proxy URL must be same-origin and app/asset scoped");
assert.match(uiSource, /transportStatus === "uploaded"/, "Creative proxy preview must be scoped to uploaded assets");
assert.match(uiSource, /const downloadUrl = creativeAssetDownloadUrl\(asset, app\.id\)/, "Creative download button must use the Product download route when available");
assert.match(uiSource, /referrerPolicy="no-referrer"/, "Creative preview image must not leak referrer details to signed URL hosts");
assert.match(uiSource, /onError=\{markPreviewFailed\}/, "Creative preview image must expose a safe failed-load state");
assert.match(uiSource, /Preview failed to load/, "Creative preview load failure must render a specific state");
assert.doesNotMatch(uiSource, /Download remains available/, "Creative asset card must not render Product-authored explanatory prose");
assert.doesNotMatch(uiSource, /Creative generated an asset/, "Creative asset card must not render Product-authored explanatory prose");
assert.match(uiSource, /transport_status/, "UI must display Creative artifact transport status");
assert.match(packageSource, /smoke:cmo-creative-user-copy/, "Creative user-facing copy audit must be wired into package scripts");
assert.match(uiSource, /has_signed_url/, "Missing Creative preview diagnostics must include signed URL presence");
assert.match(uiSource, /has_render_url/, "Missing Creative preview diagnostics must include render URL presence");
assert.match(uiSource, /resolved_preview_url_host/, "Creative preview diagnostics must include URL host without the signed token");
assert.match(uiSource, /resolved_preview_url_path_starts_with_storage_sign/, "Creative preview diagnostics must identify Supabase signed object paths without logging tokens");
assert.match(uiSource, /has_storage_path/, "Creative preview diagnostics must include storage path presence without exposing the path");
assert.match(uiSource, /http_status/, "Creative preview diagnostics must include safe HTTP status context");
assert.match(uiSource, /isBrowserPreviewUrl/, "UI must not render local paths as previews");
const cspSource = `${nextConfigSource}\n${proxySource}`;
if (/Content-Security-Policy|img-src/i.test(cspSource)) {
  assert.match(cspSource, /img-src[^;]*(gestlbswqvibztqcidis\.supabase\.co|NEXT_PUBLIC_SUPABASE_URL|\*)/i, "CSP img-src must allow the configured Supabase Storage origin when CSP is present");
}
assert.match(ingestRouteSource, /uploadCmoCreativeArtifact/, "Creative artifact ingest endpoint must exist");
assert.match(ingestRouteSource, /x-cmo-creative-ingest-key/, "Creative ingest endpoint must require server-to-server key when configured");
assert.match(ingestRouteSource, /metadata_json/, "Creative ingest endpoint must accept Hermes metadata_json multipart field");
assert.match(ingestRouteSource, /workspace_id/, "Creative ingest endpoint must accept Hermes workspace_id multipart field");
assert.match(ingestRouteSource, /asset_id/, "Creative ingest endpoint must accept Hermes asset_id multipart field");
assert.match(ingestRouteSource, /render_url/, "Creative ingest response must include Product render_url receipt field");
assert.match(creativeAssetsSource, /getCmoCreativeStoredAsset/, "Product must look up Creative assets before proxying private storage bytes");
assert.match(creativeAssetsSource, /\.select\("id,tenant_id,workspace_id,app_id,type,storage_path,bytes,sha256,status,metadata_json"\)/, "Creative asset lookup must read stored status before download");
assert.match(creativeAssetsSource, /\.from\("cmo_creative_assets"\)[\s\S]*\.eq\("id", input\.assetId\)[\s\S]*\.eq\("tenant_id", input\.tenantId\)[\s\S]*\.eq\("workspace_id", input\.workspaceId\)[\s\S]*\.eq\("app_id", input\.appId\)/, "Creative asset lookup must be scoped by asset/app/workspace/tenant");
assert.match(creativeAssetsSource, /downloadCmoCreativeStoredAsset/, "Product must download Creative assets server-side from private Supabase Storage");
assert.match(creativeAssetsSource, /\.storage[\s\S]*\.from\(CMO_CREATIVE_ASSETS_BUCKET\)[\s\S]*\.download\(asset\.storagePath\)/, "Creative proxy must read bytes from the private cmo-creative-assets bucket");
assert.match(creativeAssetsSource, /mime_type: mimeType/, "Creative ingest metadata must preserve mime_type for proxy response headers");
assert.match(creativeAssetResponseSource, /requireRequestUserIfAuthRequired/, "Creative asset proxy must validate Product user/session access when auth is required");
assert.match(creativeAssetResponseSource, /CMO_CREATIVE_ARTIFACT_READ_HEADER = "x-cmo-creative-artifact-key"/, "Creative asset proxy must accept the internal artifact read header");
assert.match(creativeAssetResponseSource, /getCmoCreativeArtifactReadKey/, "Creative asset proxy must validate the dedicated artifact read key");
assert.match(creativeAssetResponseSource, /timingSafeEqual/, "Creative asset proxy should use constant-time key comparison");
assert.match(creativeAssetResponseSource, /creative_artifact_read_unauthorized/, "Wrong artifact read key must return 401");
assert.match(creativeAssetResponseSource, /Authentication required[\s\S]*401[\s\S]*authentication_required/, "Creative asset proxy must return 401 for missing required auth");
assert.match(creativeAssetResponseSource, /requireWorkspaceRegistryEntry/, "Creative asset proxy must use workspace registry scope");
assert.match(creativeAssetResponseSource, /STORED_ASSET_STATUSES/, "Creative asset proxy must validate stored/uploaded status before serving bytes");
assert.match(creativeAssetResponseSource, /CMO_CREATIVE_ALLOWED_MIME_TYPES/, "Creative asset proxy must validate allowed MIME types before serving bytes");
assert.match(creativeAssetResponseSource, /hermes_local_artifact_path_redacted/, "Creative asset proxy must not serve redacted Hermes local paths");
assert.match(creativeAssetResponseSource, /creative_asset_not_renderable/, "Creative asset proxy must reject synthetic non-renderable placeholders");
assert.match(creativeAssetResponseSource, /Content-Type/, "Creative preview route must set Content-Type");
assert.match(creativeAssetResponseSource, /Content-Length/, "Creative preview route should set Content-Length when available");
assert.match(creativeAssetResponseSource, /Cache-Control"[\s\S]*private, max-age=300/, "Creative preview route must set private short cache headers");
assert.match(creativeAssetResponseSource, /ETag/, "Creative preview route should emit sha256 ETag when available");
assert.match(creativeAssetResponseSource, /Content-Disposition/, "Creative download route must set attachment disposition");
assert.match(creativeAssetResponseSource, /new Response\(blob/, "Creative asset proxy must stream/return stored object bytes");
assert.match(creativeAssetPreviewRouteSource, /mode: "preview"/, "Preview route must call shared proxy in preview mode");
assert.match(creativeAssetDownloadRouteSource, /mode: "download"/, "Download route must call shared proxy in download mode");
assert.match(creativeAgentSource, /value\.image_path/, "Product must parse Hermes Creative image_path execution responses");
assert.match(creativeAgentSource, /creative_assets/, "Product must parse Hermes uploaded creative_assets responses");
assert.match(creativeAgentSource, /generated_assets/, "Product must parse Hermes generated_assets responses");
assert.match(creativeAgentSource, /isProductBackedRenderableCreativeAsset/, "Product must prefer renderable Product-backed Creative assets");
assert.match(creativeAgentSource, /dedupeCreativeArtifacts/, "Product must dedupe duplicate Creative asset aliases");
assert.match(creativeAgentSource, /collectCreativeAssetCandidateRecords/, "Product must recursively promote nested Creative asset records");
assert.match(creativeAgentSource, /content_type/, "Product Creative normalizer must accept content_type aliases");
assert.match(creativeAgentSource, /render_url/, "Product Creative normalizer must preserve uploaded render_url");
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
const uploadedAssets = normalizeCreativeResponse({
  status: "success",
  routed_to_creative: true,
  creative_assets: [
    {
      schema_version: "cmo.creative_asset.v1",
      asset_id: "creative_uploaded_contract",
      asset_type: "image",
      status: "stored",
      transport_status: "uploaded",
      render_url: "https://cmo.jayju.cloud/api/signed/creative_uploaded_contract",
      signed_url: "https://cmo.jayju.cloud/api/signed/creative_uploaded_contract",
      storage_path: "holdstation/hold-pay/hold-pay/job/asset/uploaded.png",
      bytes: 2024,
      sha256: "c".repeat(64),
      mime_type: "image/png",
      model: "gpt-5.5",
      operation: "responses image_generation",
    },
  ],
});

assert.equal(assets.length, 1, "Creative image metadata must parse");
assert.equal(hermesSingleImageAssets.length, 1, "Hermes single-image execution metadata must parse");
assert.equal(uploadedAssets.length, 1, "Hermes uploaded creative_assets metadata must parse");
assert.equal(uploadedAssets[0].status, "stored", "uploaded Creative assets must be stored");
assert.equal(uploadedAssets[0].transport_status, "uploaded", "uploaded Creative assets must preserve uploaded transport status");
assert.equal(uploadedAssets[0].render_url, "https://cmo.jayju.cloud/api/signed/creative_uploaded_contract", "uploaded Creative assets must preserve Product render URL");
assert.equal(uploadedAssets[0].signed_url, "https://cmo.jayju.cloud/api/signed/creative_uploaded_contract", "uploaded Creative assets must preserve signed URL");
assert.equal(uploadedAssets[0].mime_type, "image/png", "uploaded Creative assets must preserve mime type");
assert.equal(creativeAssetPreviewUrl({
  asset_id: "creative_uploaded_primary",
  transport_status: "uploaded",
  signed_url: "https://gestlbswqvibztqcidis.supabase.co/storage/v1/object/sign/cmo-creative-assets/asset.png?token=redacted",
}, "eggs-vault"), "/api/cmo/apps/eggs-vault/creative/assets/creative_uploaded_primary/preview", "Uploaded Creative card preview must use Product same-origin proxy when asset_id exists");
assert.equal(creativeAssetDownloadUrl({
  asset_id: "creative_uploaded_primary",
  transport_status: "uploaded",
  signed_url: "https://gestlbswqvibztqcidis.supabase.co/storage/v1/object/sign/cmo-creative-assets/asset.png?token=redacted",
}, "eggs-vault"), "/api/cmo/apps/eggs-vault/creative/assets/creative_uploaded_primary/download", "Uploaded Creative download must use Product same-origin proxy when asset_id exists");
assert.equal(creativeAssetPreviewUrl({
  signed_url: "https://cmo.jayju.cloud/api/signed/primary",
  render_url: "https://cmo.jayju.cloud/api/render/fallback",
}), "https://cmo.jayju.cloud/api/signed/primary", "Creative card preview must prefer signed_url");
assert.equal(creativeAssetPreviewUrl({
  render_url: "https://cmo.jayju.cloud/api/render/only",
}), "https://cmo.jayju.cloud/api/render/only", "Creative card preview must use render_url fallback");
assert.equal(creativeAssetPreviewUrl({
  signedUrl: "https://cmo.jayju.cloud/api/signed/camel",
}), "https://cmo.jayju.cloud/api/signed/camel", "Creative card preview must support camelCase signedUrl");
assert.equal(creativeAssetPreviewUrl({
  signed_url: "https://gestlbswqvibztqcidis.supabase.co/storage/v1/object/sign/cmo-creative-assets/asset.png?token=redacted",
}), "https://gestlbswqvibztqcidis.supabase.co/storage/v1/object/sign/cmo-creative-assets/asset.png?token=redacted", "Creative card preview must accept Supabase signed object URLs");
assert.equal(creativeAssetPreviewUrl({
  signed_url: "/tmp/creative-agent-images/bad.png",
  render_url: "holdstation/hold-pay/raw-storage-path.png",
}), "", "Creative card preview must block local and storage-path-only values");
assert.equal(creativeAssetPreviewUrl({
  signed_url: "[hermes_local_artifact_path_redacted]/bad.png",
}), "", "Creative card preview must block redacted Hermes local paths");
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
assert.ok(isBrowserPreviewUrl("https://gestlbswqvibztqcidis.supabase.co/storage/v1/object/sign/cmo-creative-assets/asset.png?token=redacted"), "Supabase signed object URLs must pass browser preview safety");

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
