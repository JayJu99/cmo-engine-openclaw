import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

assert(statusRoute.includes("getVideoAgentStatus") && statusRoute.includes("getHermesVideoAgentSetupState"), "Status route must proxy safe status and setup state.");
assert(statusRoute.includes("realVideoEnabled") && statusRoute.includes("CMO_STUDIO_REAL_VIDEO_ENABLED"), "Status route must expose safe real-video enabled state.");
assert(modelsRoute.includes("getVideoAgentModels") && modelsRoute.includes("product_mock_catalog"), "Models route must proxy Hermes models and fallback to Product catalog.");
assert(!statusRoute.includes("CMO_HERMES_VIDEO_AGENT_API_KEY") && !modelsRoute.includes("CMO_HERMES_VIDEO_AGENT_API_KEY"), "Proxy routes must not expose API key names.");

assert(costRoute.includes("estimateVideoCost"), "Cost route must proxy Hermes cost.");
assert(costRoute.includes("CMO_STUDIO_REAL_VIDEO_ENABLED"), "Cost route must be gated by real-video env.");
assert(costRoute.includes("video_agent_model_unavailable"), "Cost route must reject unsupported real models.");
assert(costRoute.includes("prompt: stringValue(body.prompt)"), "Cost route must forward prompt to Hermes cost.");
assert(costRoute.includes("ui_id: providerModelId") && costRoute.includes("provider_model_id: providerModelId"), "Cost route must send Hermes model object.");
assert(costRoute.includes('mode: "fast"'), "Cost route must add fast mode for seedance_2_0 720p.");
assert(costRoute.includes("diagnostics: hermesVideoErrorDiagnostics"), "Cost route must return safe invalid/unreachable diagnostics.");

assert(jobsRoute.includes("dispatchStudioJob"), "Jobs route must dispatch after creating Product job.");
assert(jobsRoute.includes("!result.idempotent"), "Jobs route must not duplicate-dispatch idempotent retries.");
assert(dispatcher.includes("CMO_STUDIO_REAL_VIDEO_ENABLED"), "Dispatcher must be real-video gated.");
assert(dispatcher.includes("executeVideoJob"), "Dispatcher must call Hermes execute server-side.");
assert(dispatcher.includes("markStudioJobRunning") && dispatcher.includes("completeStudioJob") && dispatcher.includes("failStudioJob"), "Dispatcher must update queued/running/completed/failed Product jobs.");
assert(dispatcher.includes('providerModelId === "seedance_2_0"'), "Dispatcher v1 must only allow seedance_2_0 real execution.");
assert(dispatcher.includes("ui_id: providerModelId") && dispatcher.includes("provider_model_id: providerModelId"), "Dispatcher must send Hermes execute model object.");
assert(dispatcher.includes('mode: "fast"'), "Dispatcher must add fast mode for seedance_2_0 720p.");
assert(dispatcher.includes('mode: "product_upload"') && dispatcher.includes("upload_endpoint: null"), "Dispatcher must send product_upload transport without Product-owned upload yet.");
assert(dispatcher.includes("remote_result") && dispatcher.includes("artifact_transport_status") && dispatcher.includes("not_uploaded"), "Dispatcher must persist remote result metadata without uploading assets.");
assert(dispatcher.includes("estimatedCredits") && dispatcher.includes("render_url") && dispatcher.includes("thumbnail_url"), "Dispatcher must persist Hermes credits and remote URLs.");
assert(dispatcher.includes("hermesVideoErrorDiagnostics"), "Dispatcher must preserve safe Hermes error diagnostics.");
assert(!dispatcher.includes("/agents/studio") && !dispatcher.includes("/agents/cmo"), "Dispatcher must not use generic studio or CMO agent routes.");

assert(jobService.includes("variants: number"), "Job settings must carry variants.");
assert(jobService.includes("provider_model_id"), "Job service must persist provider model metadata.");
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

if (failures.length) {
  console.error("Studio Hermes integration contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Studio Hermes integration contract check passed.");
