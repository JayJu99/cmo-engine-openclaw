import { existsSync, readFileSync } from "node:fs";
import nodeAssert from "node:assert/strict";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";

const root = process.cwd();
const failures = [];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function assertExists(path) {
  assert(existsSync(join(root, path)), `Missing required file: ${path}`);
}

const requiredFiles = [
  "src/lib/cmo/studio/hermes-video-client.ts",
  "src/app/api/cmo/studio/video-agent/status/route.ts",
  "src/app/api/cmo/studio/video-agent/models/route.ts",
  "src/app/api/cmo/studio/cost/estimate/route.ts",
  "src/app/api/cmo/studio/jobs/route.ts",
  "src/lib/cmo/studio-dispatcher.ts",
  "src/lib/cmo/studio-job-service.ts",
  "src/components/cmo-apps/studio-view.tsx",
];

for (const file of requiredFiles) {
  assertExists(file);
}

const client = read("src/lib/cmo/studio/hermes-video-client.ts");
const statusRoute = read("src/app/api/cmo/studio/video-agent/status/route.ts");
const modelsRoute = read("src/app/api/cmo/studio/video-agent/models/route.ts");
const costRoute = read("src/app/api/cmo/studio/cost/estimate/route.ts");
const jobsRoute = read("src/app/api/cmo/studio/jobs/route.ts");
const dispatcher = read("src/lib/cmo/studio-dispatcher.ts");
const jobService = read("src/lib/cmo/studio-job-service.ts");
const catalog = read("src/lib/cmo/studio-model-catalog.ts");
const studioView = read("src/components/cmo-apps/studio-view.tsx");

assert(client.includes('import "server-only"'), "Hermes client must be server-only.");
for (const name of ["getVideoAgentStatus", "getVideoAgentModels", "estimateVideoCost", "executeVideoJob"]) {
  assert(client.includes(`function ${name}`), `Hermes client missing ${name}.`);
}
for (const path of ["/agents/video/status", "/agents/video/models", "/agents/video/cost", "/agents/video/execute"]) {
  assert(client.includes(path), `Hermes client missing ${path}.`);
}
for (const env of ["CMO_HERMES_VIDEO_AGENT_BASE_URL", "CMO_HERMES_VIDEO_AGENT_API_KEY", "CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS"]) {
  assert(client.includes(env), `Hermes client missing ${env}.`);
}
for (const code of [
  "video_agent_not_configured",
  "video_agent_unreachable",
  "video_agent_auth_failed",
  "video_agent_invalid_response",
  "video_agent_execution_failed",
]) {
  assert(client.includes(code), `Hermes client missing structured error ${code}.`);
}
assert(client.includes("AbortController") && client.includes("setTimeout"), "Hermes client must implement timeout handling.");
assert(client.includes("authorization: `Bearer ${config.apiKey}`"), "Hermes client must send bearer auth from env.");
assert(client.includes("safeUrl") && client.includes("local-path-redacted"), "Hermes client must sanitize local paths and URLs.");
assert(!client.includes("console.log") && !client.includes("console.warn"), "Hermes client must not log secrets.");
assert(client.includes("item.ui_id") && client.includes("provider_model_id"), "Hermes models normalization must accept ui_id and provider_model_id fields.");
assert(client.includes('uiId === "seedance_2_0" ? uiId : undefined'), "Hermes models normalization must fallback provider_model_id to seedance_2_0 for supported v1 real model.");
assert(client.includes("duration.min_seconds") && client.includes("duration.max_seconds") && client.includes("duration.default_seconds"), "Hermes models normalization must read nested duration fields.");
assert(client.includes("resolutions") && client.includes("default_resolution"), "Hermes models normalization must read resolution fields.");
assert(client.includes("real_video_supported"), "Hermes models normalization must mark real-video support.");
assert(client.includes("estimate_available") && client.includes("estimated_credits"), "Hermes cost normalization must accept snake_case estimate fields.");
assert(client.includes("estimatedCredits") && client.includes("`~${credits} credits`"), "Hermes cost normalization must return Product estimatedCredits and label.");
assert(client.includes("body.reason") && client.includes("body.code"), "Hermes cost normalization must preserve unavailable reason/code.");
assert(client.includes("body.video") && client.includes("body.cost") && client.includes("body.diagnostics"), "Hermes execute normalization must read nested video/cost/diagnostics.");
assert(client.includes("diagnostics.higgsfield_job_id"), "Hermes execute normalization must use diagnostics.higgsfield_job_id as provider job id.");
assert(client.includes("hermesVideoErrorDiagnostics"), "Hermes client must expose safe error diagnostics.");
assert(client.includes("upstream_error") && client.includes("upstream_schema_version"), "Hermes client must preserve safe upstream execute error bodies.");

assert(statusRoute.includes("getVideoAgentStatus") && statusRoute.includes("getHermesVideoAgentSetupState"), "Status route must proxy safe status and setup state.");
assert(statusRoute.includes("realVideoEnabled") && statusRoute.includes("CMO_STUDIO_REAL_VIDEO_ENABLED"), "Status route must expose safe real-video enabled state.");
assert(modelsRoute.includes("getVideoAgentModelsCatalog"), "Models route must return normalized Hermes/Product fallback catalog.");
assert(!statusRoute.includes("CMO_HERMES_VIDEO_AGENT_API_KEY") && !modelsRoute.includes("CMO_HERMES_VIDEO_AGENT_API_KEY"), "Proxy routes must not expose API key names.");

assert(costRoute.includes("estimateVideoCost"), "Cost route must proxy Hermes cost.");
assert(costRoute.includes("CMO_STUDIO_REAL_VIDEO_ENABLED"), "Cost route must be gated by real-video env.");
assert(costRoute.includes("video_agent_model_unavailable"), "Cost route must reject unsupported real models.");
assert(costRoute.includes("prompt: stringValue(body.prompt)"), "Cost route must forward prompt to Hermes cost.");
assert(costRoute.includes("ui_id: providerModelId") && costRoute.includes("provider_model_id: providerModelId"), "Cost route must send Hermes model object.");
assert(costRoute.includes("chooseStudioVideoMode"), "Cost route must choose Hermes mode from catalog settings.");
assert(costRoute.includes("diagnostics: hermesVideoErrorDiagnostics"), "Cost route must return safe invalid/unreachable diagnostics.");

assert(jobsRoute.includes("dispatchStudioJob"), "Jobs route must dispatch after creating Product job.");
assert(jobsRoute.includes("!result.idempotent"), "Jobs route must not duplicate-dispatch idempotent retries.");
assert(jobsRoute.includes("costEstimate"), "Jobs route must pass Product Hermes cost estimates into job creation.");
assert(dispatcher.includes("CMO_STUDIO_REAL_VIDEO_ENABLED"), "Dispatcher must be real-video gated.");
assert(dispatcher.includes("executeVideoJob"), "Dispatcher must call Hermes execute server-side.");
assert(dispatcher.includes("markStudioJobRunning") && dispatcher.includes("completeStudioJob") && dispatcher.includes("failStudioJob"), "Dispatcher must update queued/running/completed/failed Product jobs.");
assert(dispatcher.includes("realVideoProviderModelId") && dispatcher.includes("provider_model_id"), "Dispatcher must use provider_model_id for real execution.");
assert(dispatcher.includes('schema_version: "video.generation.request.v1"'), "Dispatcher must send Hermes execute schema_version.");
assert(dispatcher.includes('request_id: job.request_id ?? job.id'), "Dispatcher must send a stable Hermes request_id.");
assert(dispatcher.includes('backend: "higgsfield"'), "Dispatcher must send Hermes execute backend.");
assert(dispatcher.includes("ui_id: providerModelId") && dispatcher.includes("provider_model_id: providerModelId"), "Dispatcher must send Hermes execute model object.");
assert(dispatcher.includes("chooseStudioVideoMode"), "Dispatcher must choose Hermes mode from catalog settings.");
assert(dispatcher.includes("images: []") && dispatcher.includes("videos: []") && dispatcher.includes("audio: []"), "Dispatcher must send empty media input arrays for v1 text-to-video.");
assert(dispatcher.includes("include_estimate: true") && dispatcher.includes("require_estimate: false"), "Dispatcher must request a non-blocking Hermes cost estimate.");
assert(dispatcher.includes('mode: "product_upload"') && dispatcher.includes("upload_endpoint: null"), "Dispatcher must send product_upload transport without Product-owned upload yet.");
assert(dispatcher.includes("uploadCompletedStudioVideoFromRemote") && dispatcher.includes('artifact_transport_status: uploadedAsset ? "product_uploaded" : uploadError ? "upload_failed"'), "Dispatcher must upload completed remote video artifacts and preserve upload failure fallback.");
assert(dispatcher.includes("estimatedCredits") && dispatcher.includes("render_url") && dispatcher.includes("thumbnail_url"), "Dispatcher must persist Hermes credits and remote URLs.");
assert(dispatcher.includes("hermesVideoErrorDiagnostics"), "Dispatcher must preserve safe Hermes error diagnostics.");
assert(!dispatcher.includes("/agents/studio") && !dispatcher.includes("/agents/cmo"), "Dispatcher must not use generic studio or CMO agent routes.");

assert(jobService.includes("variants: number"), "Job settings must carry variants.");
assert(jobService.includes("provider_model_id"), "Job service must persist provider model metadata.");
assert(jobService.includes("normalizeHermesCostEstimate") && jobService.includes("estimateAvailable: true"), "Job service must persist Product Hermes cost estimates in real-video mode.");
assert(jobService.includes('process.env.CMO_STUDIO_REAL_VIDEO_ENABLED === "true"'), "Mock progression must pause in real-video mode.");
assert(catalog.includes('providerModelId: "seedance_2_0"') && catalog.includes("realVideoSupported: true"), "Catalog must map real v1 Seedance model.");

assert(studioView.includes("/api/cmo/studio/video-agent/status"), "Studio UI must call Product status proxy.");
assert(studioView.includes("/api/cmo/studio/video-agent/models"), "Studio UI must call Product models proxy.");
assert(studioView.includes("Remote Higgsfield result") && studioView.includes("<video"), "Studio UI must preview remote real results.");
assert(studioView.includes('REAL_STUDIO_VIDEO_PROVIDER_MODEL_ID = "seedance_2_0"'), "Studio UI must know the v1 real default model.");
assert(studioView.includes("setModelId(realDefaultModel.id)"), "Studio UI must default to Seedance 2.0 when Hermes real mode is connected.");
assert(studioView.includes("Selected model is not available for real Studio video generation."), "Studio UI must show the unsupported real model Generate guard.");
assert(studioView.includes("Boolean(generateBlockedReason)"), "Studio UI must disable Generate when a real model is unavailable.");
assert(studioView.includes("prompt,") && studioView.includes('operation: "generate_video"'), "Studio UI cost request must include prompt and operation.");
assert(studioView.includes("costEstimate") && studioView.includes('mode === "hermes"'), "Studio UI must attach Product Hermes cost estimate to generated jobs.");
assert(!studioView.includes("CMO_HERMES") && !studioView.includes("/agents/video") && !studioView.includes("API_SERVER_KEY"), "Browser UI must not call Hermes directly or expose secrets.");
assert(!existsSync(join(root, "src/app/apps/[appId]/studio")) && !existsSync(join(root, "src/app/api/cmo/apps/[appId]/studio")), "App-scoped Studio route must not exist.");

const studioSource = [
  client,
  statusRoute,
  modelsRoute,
  costRoute,
  jobsRoute,
  dispatcher,
  jobService,
  catalog,
  studioView,
].join("\n");

for (const forbidden of ["/agents/studio", "/agents/cmo", "vault", "memory", "Lens", "Surf", "Echo"]) {
  assert(!studioSource.includes(forbidden), `Studio Hermes integration must not introduce ${forbidden}.`);
}

await checkHermesExecutePayloadContract();
await checkHermesCostRouteSnakeCaseMapping();
await checkHermesExecuteCompletedResponseMapping();
await checkHermesExecuteFailedResponseMapping();
await checkHermesExecuteErrorDiagnostics();

if (failures.length) {
  console.error("Studio Hermes integration contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Studio Hermes integration contract check passed.");

async function checkHermesExecutePayloadContract() {
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: { "@": resolve("src"), "server-only": resolve("scripts/server-only-noop.cjs") },
  });
  const { buildHermesVideoExecuteRequest } = await jiti.import(resolve("src/lib/cmo/studio-dispatcher.ts"));
  const payload = buildHermesVideoExecuteRequest({
    id: "studio_job_contract",
    tenant_id: "tenant_contract",
    created_by: "tester",
    status: "running",
    media_kind: "video",
    agent: "video",
    backend: "higgsfield",
    operation: "generate_video",
    context_json: {
      product_route: "/studio",
    },
    prompt: "actual user prompt",
    negative_prompt: null,
    model_json: {
      product_model_id: "seedance-2",
      ui_id: "seedance_2_0",
      provider_model_id: "seedance_2_0",
      name: "Seedance 2.0",
      enablement: "safe_now",
      settings_schema: {
        duration: { min: 4, max: 15, default: 5 },
        aspect_ratio: { default: "16:9", values: ["16:9", "9:16", "1:1"] },
        resolution: { default: "720p", values: ["480p", "720p", "1080p", "4k"] },
        mode: { default: "std", values: ["fast", "std"] },
        bitrate_mode: { default: "standard", values: ["standard", "high"] },
      },
      constraints: ["mode 'fast' supports only 480p/720p; use mode 'std' for 1080p/4k"],
    },
    settings_json: {
      durationSeconds: 5,
      aspectRatio: "9:16",
      resolution: "720p",
      bitrate: "standard",
      variants: 1,
    },
    input_asset_ids: [],
    output_asset_ids: [],
    cost_json: {},
    provider_job_id: null,
    provider_status: null,
    error_json: null,
    diagnostics_json: {},
    request_id: "debug_execute_001",
    dispatch_attempts: 1,
    dispatch_started_at: null,
    locked_until: null,
    created_at: "2026-06-29T00:00:00.000Z",
    started_at: "2026-06-29T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-06-29T00:00:00.000Z",
  });

  nodeAssert.equal(payload.schema_version, "video.generation.request.v1");
  nodeAssert.equal(payload.request_id, "debug_execute_001");
  nodeAssert.equal(payload.job_id, "studio_job_contract");
  nodeAssert.deepEqual(payload.context, {
    source: "studio",
    app_id: null,
    workspace_id: null,
    campaign_id: null,
    brand_id: null,
  });
  nodeAssert.equal(payload.operation, "generate_video");
  nodeAssert.equal(payload.backend, "higgsfield");
  nodeAssert.deepEqual(payload.model, {
    ui_id: "seedance_2_0",
    provider_model_id: "seedance_2_0",
  });
  nodeAssert.equal(payload.model.ui_id, "seedance_2_0", "Product model id seedance-2 must never be sent as Hermes model.ui_id.");
  nodeAssert.equal(payload.prompt, "actual user prompt");
  nodeAssert.deepEqual(payload.settings, {
    duration_seconds: 5,
    aspect_ratio: "9:16",
    resolution: "720p",
    bitrate: "standard",
    variants: 1,
    mode: "fast",
  });
  nodeAssert.deepEqual(payload.inputs, {
    images: [],
    videos: [],
    audio: [],
  });
  nodeAssert.deepEqual(payload.cost, {
    include_estimate: true,
    require_estimate: false,
  });
  nodeAssert.deepEqual(payload.artifact_transport, {
    mode: "product_upload",
    upload_endpoint: null,
    headers: {},
  });
}

async function checkHermesCostRouteSnakeCaseMapping() {
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: { "@": resolve("src"), "server-only": resolve("scripts/server-only-noop.cjs") },
  });
  const { POST } = await jiti.import(resolve("src/app/api/cmo/studio/cost/estimate/route.ts"));
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    CMO_HERMES_VIDEO_AGENT_BASE_URL: process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL,
    CMO_HERMES_VIDEO_AGENT_API_KEY: process.env.CMO_HERMES_VIDEO_AGENT_API_KEY,
    CMO_STUDIO_REAL_VIDEO_ENABLED: process.env.CMO_STUDIO_REAL_VIDEO_ENABLED,
    CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS: process.env.CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS,
  };
  let capturedCostRequest = null;

  process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL = "http://127.0.0.1:18642";
  process.env.CMO_HERMES_VIDEO_AGENT_API_KEY = "test-contract-secret";
  process.env.CMO_STUDIO_REAL_VIDEO_ENABLED = "true";
  process.env.CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS = "1000";

  try {
    globalThis.fetch = async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      const authorization = init?.headers instanceof Headers
        ? init.headers.get("authorization")
        : init?.headers?.authorization;

      nodeAssert.equal(authorization, "Bearer test-contract-secret");

      if (pathname === "/agents/video/models") {
        return new Response(JSON.stringify({
          schema_version: "video.models.response.v2",
          source: "higgsfield_cli",
          models: [{
            ui_id: "seedance_2_0",
            provider_model_id: "seedance_2_0",
            label: "Seedance 2.0",
            provider: "higgsfield",
            type: "video",
            operations: ["text_to_video"],
            real_video_supported: true,
            cost_supported: true,
            settings_schema: {
              duration: { type: "integer", default: 5, min: 4, max: 15 },
              aspect_ratio: { default: "16:9", values: ["16:9", "9:16", "1:1"] },
              resolution: { default: "720p", values: ["480p", "720p", "1080p", "4k"] },
              mode: { default: "std", values: ["fast", "std"] },
              bitrate_mode: { default: "standard", values: ["standard", "high"] },
            },
            enablement: "safe_now",
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (pathname === "/agents/video/cost") {
        capturedCostRequest = JSON.parse(String(init?.body ?? "{}"));

        return new Response(JSON.stringify({
          schema_version: "video.cost.response.v1",
          request_id: "debug_cost_001",
          estimate_available: true,
          backend: "higgsfield",
          model: "seedance_2_0",
          estimated_credits: 17.5,
          raw: {},
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected Hermes mock path: ${pathname}`);
    };

    const response = await POST(new Request("http://product.test/api/cmo/studio/cost/estimate", {
      method: "POST",
      body: JSON.stringify({
        prompt: "actual user prompt",
        mediaKind: "video",
        backend: "higgsfield",
        operation: "generate_video",
        model: {
          uiId: "seedance_2_0",
          providerModelId: "seedance_2_0",
        },
        settings: {
          durationSeconds: 5,
          aspectRatio: "9:16",
          resolution: "720p",
          bitrate: "standard",
          variants: 1,
        },
      }),
      headers: { "Content-Type": "application/json" },
    }));
    const body = await response.json();

    nodeAssert.equal(response.status, 200);
    nodeAssert.deepEqual(body, {
      estimateAvailable: true,
      mode: "hermes",
      credits: 17.5,
      estimatedCredits: 17.5,
      label: "~17.5 credits",
      backend: "higgsfield",
      model: "seedance_2_0",
    });
    nodeAssert.equal(capturedCostRequest.prompt, "actual user prompt");
    nodeAssert.deepEqual(capturedCostRequest.model, {
      ui_id: "seedance_2_0",
      provider_model_id: "seedance_2_0",
    });
    nodeAssert.deepEqual(capturedCostRequest.settings, {
      duration_seconds: 5,
      aspect_ratio: "9:16",
      resolution: "720p",
      bitrate: "standard",
      variants: 1,
      mode: "fast",
    });
    nodeAssert.equal(JSON.stringify(body).includes("test-contract-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function checkHermesExecuteCompletedResponseMapping() {
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: { "@": resolve("src"), "server-only": resolve("scripts/server-only-noop.cjs") },
  });
  const { executeVideoJob } = await jiti.import(resolve("src/lib/cmo/studio/hermes-video-client.ts"));
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    CMO_HERMES_VIDEO_AGENT_BASE_URL: process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL,
    CMO_HERMES_VIDEO_AGENT_API_KEY: process.env.CMO_HERMES_VIDEO_AGENT_API_KEY,
    CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS: process.env.CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS,
  };

  process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL = "http://127.0.0.1:18642";
  process.env.CMO_HERMES_VIDEO_AGENT_API_KEY = "test-contract-secret";
  process.env.CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS = "1000";

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      schema_version: "video.generation.response.v1",
      status: "completed",
      backend: "higgsfield",
      operation: "generate_video",
      model: "seedance_2_0",
      video: {
        render_url: "https://cdn.example.test/render.mp4",
        preview_url: "https://cdn.example.test/preview.mp4",
        thumbnail_url: "https://cdn.example.test/thumb.webp",
        duration_seconds: 5,
        aspect_ratio: "9:16",
        resolution: "720p",
      },
      cost: {
        estimate_available: true,
        estimated_credits: 17.5,
      },
      diagnostics: {
        higgsfield_job_id: "higgs_job_123",
        artifact_transport_status: "not_uploaded",
        real_cli: true,
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const result = await executeVideoJob(videoExecuteFixture());

    nodeAssert.equal(result.status, "completed");
    nodeAssert.equal(result.provider_status, "completed");
    nodeAssert.equal(result.provider_job_id, "higgs_job_123");
    nodeAssert.equal(result.estimated_credits, 17.5);
    nodeAssert.equal(result.estimatedCredits, 17.5);
    nodeAssert.equal(result.backend, "higgsfield");
    nodeAssert.equal(result.model, "seedance_2_0");
    nodeAssert.equal(result.render_url, "https://cdn.example.test/render.mp4");
    nodeAssert.equal(result.thumbnail_url, "https://cdn.example.test/thumb.webp");
    nodeAssert.equal(result.duration_seconds, 5);
    nodeAssert.equal(result.aspect_ratio, "9:16");
    nodeAssert.equal(result.resolution, "720p");
    nodeAssert.equal(result.diagnostics.artifact_transport_status, "not_uploaded");
    nodeAssert.equal(JSON.stringify(result).includes("test-contract-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function checkHermesExecuteFailedResponseMapping() {
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: { "@": resolve("src"), "server-only": resolve("scripts/server-only-noop.cjs") },
  });
  const { executeVideoJob } = await jiti.import(resolve("src/lib/cmo/studio/hermes-video-client.ts"));
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    CMO_HERMES_VIDEO_AGENT_BASE_URL: process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL,
    CMO_HERMES_VIDEO_AGENT_API_KEY: process.env.CMO_HERMES_VIDEO_AGENT_API_KEY,
    CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS: process.env.CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS,
  };

  process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL = "http://127.0.0.1:18642";
  process.env.CMO_HERMES_VIDEO_AGENT_API_KEY = "test-contract-secret";
  process.env.CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS = "1000";

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      schema_version: "video.generation.response.v1",
      status: "failed",
      backend: "higgsfield",
      model: "seedance_2_0",
      error: {
        code: "higgsfield_failed",
        message: "Generation failed.",
      },
      diagnostics: {
        higgsfield_job_id: "higgs_job_failed",
        artifact_transport_status: "not_uploaded",
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const result = await executeVideoJob(videoExecuteFixture());
    const serialized = JSON.stringify(result).toLowerCase();

    nodeAssert.equal(result.status, "failed");
    nodeAssert.equal(result.provider_job_id, "higgs_job_failed");
    nodeAssert.deepEqual(result.error, {
      code: "higgsfield_failed",
      message: "Generation failed.",
    });
    nodeAssert.equal(result.diagnostics.artifact_transport_status, "not_uploaded");
    nodeAssert.equal(serialized.includes("test-contract-secret"), false);
    nodeAssert.equal(serialized.includes("c:\\users"), false);
  } finally {
    globalThis.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function checkHermesExecuteErrorDiagnostics() {
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: { "@": resolve("src"), "server-only": resolve("scripts/server-only-noop.cjs") },
  });
  const { executeVideoJob, hermesVideoErrorDiagnostics } = await jiti.import(resolve("src/lib/cmo/studio/hermes-video-client.ts"));
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    CMO_HERMES_VIDEO_AGENT_BASE_URL: process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL,
    CMO_HERMES_VIDEO_AGENT_API_KEY: process.env.CMO_HERMES_VIDEO_AGENT_API_KEY,
    CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS: process.env.CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS,
  };

  process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL = "http://127.0.0.1:18642";
  process.env.CMO_HERMES_VIDEO_AGENT_API_KEY = "test-contract-secret";
  process.env.CMO_STUDIO_VIDEO_AGENT_TIMEOUT_MS = "1000";

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      schema_version: "video.generation.error.v1",
      error: {
        type: "invalid_request",
        message: "Missing required inputs at C:\\Users\\Jay\\hermes\\debug.json",
        retryable: false,
      },
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

    await nodeAssert.rejects(
      () => executeVideoJob({
        schema_version: "video.generation.request.v1",
        request_id: "debug_execute_001",
        job_id: "studio_job_contract",
        context: {
          source: "studio",
          app_id: null,
          workspace_id: null,
          campaign_id: null,
          brand_id: null,
        },
        operation: "generate_video",
        backend: "higgsfield",
        model: {
          ui_id: "seedance_2_0",
          provider_model_id: "seedance_2_0",
        },
        prompt: "actual user prompt",
        settings: {
          duration_seconds: 5,
          aspect_ratio: "9:16",
          resolution: "720p",
          mode: "fast",
          bitrate: "standard",
          variants: 1,
        },
        inputs: {
          images: [],
          videos: [],
          audio: [],
        },
        cost: {
          include_estimate: true,
          require_estimate: false,
        },
        artifact_transport: {
          mode: "product_upload",
          upload_endpoint: null,
          headers: {},
        },
      }),
      (error) => {
        const diagnostics = hermesVideoErrorDiagnostics(error, {
          targetPath: "/agents/video/execute",
          hermesDispatched: true,
        });
        const serialized = JSON.stringify(diagnostics).toLowerCase();

        nodeAssert.equal(diagnostics.http_status, 400);
        nodeAssert.equal(diagnostics.target_path, "/agents/video/execute");
        nodeAssert.equal(diagnostics.hermes_dispatched, true);
        nodeAssert.equal(diagnostics.upstream_schema_version, "video.generation.error.v1");
        nodeAssert.deepEqual(diagnostics.upstream_error, {
          type: "invalid_request",
          message: "Missing required inputs at [local-path-redacted]",
          retryable: false,
        });
        nodeAssert.equal(serialized.includes("test-contract-secret"), false);
        nodeAssert.equal(serialized.includes("authorization"), false);
        nodeAssert.equal(serialized.includes("bearer"), false);
        nodeAssert.equal(serialized.includes("c:\\users"), false);

        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function videoExecuteFixture() {
  return {
    schema_version: "video.generation.request.v1",
    request_id: "debug_execute_001",
    job_id: "studio_job_contract",
    context: {
      source: "studio",
      app_id: null,
      workspace_id: null,
      campaign_id: null,
      brand_id: null,
    },
    operation: "generate_video",
    backend: "higgsfield",
    model: {
      ui_id: "seedance_2_0",
      provider_model_id: "seedance_2_0",
    },
    prompt: "actual user prompt",
    settings: {
      duration_seconds: 5,
      aspect_ratio: "9:16",
      resolution: "720p",
      mode: "fast",
      bitrate: "standard",
      variants: 1,
    },
    inputs: {
      images: [],
      videos: [],
      audio: [],
    },
    cost: {
      include_estimate: true,
      require_estimate: false,
    },
    artifact_transport: {
      mode: "product_upload",
      upload_endpoint: null,
      headers: {},
    },
  };
}
