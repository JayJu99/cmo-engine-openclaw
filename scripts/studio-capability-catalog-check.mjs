import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const root = process.cwd();
const clientSource = readFileSync("src/lib/cmo/studio/hermes-video-client.ts", "utf8");
const uiSource = readFileSync("src/components/cmo-apps/studio-view.tsx", "utf8");
const jobRouteSource = readFileSync("src/app/api/cmo/studio/jobs/route.ts", "utf8");
const dispatcherSource = readFileSync("src/lib/cmo/studio-dispatcher.ts", "utf8");

assert.match(clientSource, /video\.models\.response\.v2/, "Hermes client must recognize v2 catalog schema.");
assert.match(clientSource, /settings_schema/, "Hermes client must read settings_schema.");
assert.match(clientSource, /enablement/, "Hermes client must preserve model enablement.");
assert.match(uiSource, /enablementLabel/, "Studio UI must show model enablement.");
assert.match(uiSource, /catalogSource/, "Studio UI must show catalog source.");
assert.match(jobRouteSource, /validateStudioVideoSettings/, "Jobs route must validate settings before dispatch.");
assert.match(dispatcherSource, /assertFreshCostGuard/, "Dispatcher must run a fresh cost guard before execute.");

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": resolve(root, "src"), "server-only": resolve(root, "scripts/server-only-noop.cjs") },
});
const { getVideoAgentModels } = await jiti.import(resolve(root, "src/lib/cmo/studio/hermes-video-client.ts"));

async function withHermesModels(payload, check) {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    CMO_HERMES_VIDEO_AGENT_BASE_URL: process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL,
    CMO_HERMES_VIDEO_AGENT_API_KEY: process.env.CMO_HERMES_VIDEO_AGENT_API_KEY,
    CMO_STUDIO_REAL_VIDEO_MODEL_ALLOWLIST: process.env.CMO_STUDIO_REAL_VIDEO_MODEL_ALLOWLIST,
  };

  process.env.CMO_HERMES_VIDEO_AGENT_BASE_URL = "http://127.0.0.1:18642";
  process.env.CMO_HERMES_VIDEO_AGENT_API_KEY = "test-contract-secret";
  delete process.env.CMO_STUDIO_REAL_VIDEO_MODEL_ALLOWLIST;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/agents\/video\/models$/, "Models request must call Hermes models endpoint.");
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await check(await getVideoAgentModels());
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

await withHermesModels({
  schema_version: "video.models.response.v2",
  backend: "higgsfield",
  provider: "higgsfield",
  source: "higgsfield_cli",
  cache_ttl_seconds: 300,
  models: [
    {
      ui_id: "seedance_2_0",
      provider_model_id: "seedance_2_0",
      label: "Seedance 2.0",
      provider: "higgsfield",
      type: "video",
      family: "seedance",
      operations: ["text_to_video", "image_to_video"],
      real_video_supported: true,
      cost_supported: true,
      workflow_supported: false,
      inputs_required: ["prompt"],
      settings_schema: {
        duration: { type: "integer", default: 5, min: 4, max: 15 },
        aspect_ratio: { default: "16:9", values: ["16:9", "9:16", "1:1"] },
        resolution: { default: "720p", values: ["480p", "720p", "1080p", "4k"] },
        mode: { default: "std", values: ["fast", "std"] },
        bitrate_mode: { default: "standard", values: ["standard", "high"] },
        generate_audio: { type: "boolean", default: true },
      },
      constraints: ["mode 'fast' supports only 480p/720p; use mode 'std' for 1080p/4k"],
      warnings: [],
      enablement: "safe_now",
    },
    {
      ui_id: "experimental_model",
      provider_model_id: "experimental_model",
      label: "Experimental",
      real_video_supported: true,
      settings_schema: {
        duration: { default: 5, min: 4, max: 8 },
        aspect_ratio: { default: "16:9", values: ["16:9"] },
        resolution: { default: "720p", values: ["720p"] },
        mode: { default: "fast", values: ["fast"] },
        bitrate_mode: { default: "standard", values: ["standard"] },
      },
      enablement: "needs_smoke",
    },
    {
      ui_id: "safe_but_not_allowlisted",
      provider_model_id: "safe_but_not_allowlisted",
      label: "Safe But Not Allowlisted",
      real_video_supported: true,
      cost_supported: true,
      settings_schema: {
        duration: { default: 5, min: 4, max: 8 },
        aspect_ratio: { default: "16:9", values: ["16:9"] },
        resolution: { default: "720p", values: ["720p"] },
        mode: { default: "fast", values: ["fast"] },
        bitrate_mode: { default: "standard", values: ["standard"] },
      },
      enablement: "safe_now",
    },
    {
      ui_id: "image_to_video_only",
      provider_model_id: "image_to_video_only",
      label: "Image Input Required",
      real_video_supported: true,
      settings_schema: {
        duration: { default: 5, min: 4, max: 8 },
        aspect_ratio: { default: "16:9", values: ["16:9"] },
        resolution: { default: "720p", values: ["720p"] },
        mode: { default: "fast", values: ["fast"] },
        bitrate_mode: { default: "standard", values: ["standard"] },
      },
      enablement: "disabled_until_upload",
    },
  ],
}, async (models) => {
  assert.equal(models.length, 4, "All Hermes v2 models must remain visible.");
  const seedance = models.find((model) => model.providerModelId === "seedance_2_0");
  assert.equal(seedance?.enablement, "safe_now");
  assert.equal(seedance?.available, true);
  assert.equal(seedance?.catalogSource, "higgsfield_cli");
  assert.deepEqual(seedance?.supportedResolutions, ["480p", "720p", "1080p", "4K"]);
  assert.deepEqual(seedance?.supportedModes, ["fast", "std"]);
  assert.equal(seedance?.defaultDurationSeconds, 5);
  assert.equal(seedance?.supportsAudio, true);
  assert.equal(models.find((model) => model.id === "experimental_model")?.disabledReason, "Needs smoke test before real generation.");
  assert.equal(models.find((model) => model.id === "safe_but_not_allowlisted")?.enablement, "needs_smoke", "Default Product allowlist must only expose seedance_2_0 for paid real generation.");
  assert.equal(models.find((model) => model.id === "image_to_video_only")?.disabledReason, "Requires input media support.");
});

await withHermesModels({
  schema_version: "video.models.response.v1",
  models: [
    {
      ui_id: "seedance_2_0",
      provider_model_id: "seedance_2_0",
      label: "Seedance 2.0",
      duration: { default_seconds: 5, min_seconds: 4, max_seconds: 15 },
      resolutions: ["480p", "720p"],
      default_resolution: "720p",
      real_video_supported: true,
    },
  ],
}, async (models) => {
  assert.equal(models[0].providerModelId, "seedance_2_0", "Legacy v1 catalog must still normalize provider model id.");
  assert.equal(models[0].enablement, "safe_now", "Legacy available v1 model should remain executable.");
});

console.log("Studio capability catalog check passed.");
