import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const root = process.cwd();
const dispatcherSource = readFileSync("src/lib/cmo/studio-dispatcher.ts", "utf8");
const costRouteSource = readFileSync("src/app/api/cmo/studio/cost/estimate/route.ts", "utf8");
const jobsRouteSource = readFileSync("src/app/api/cmo/studio/jobs/route.ts", "utf8");
const uiSource = readFileSync("src/components/cmo-apps/studio-view.tsx", "utf8");

assert.match(costRouteSource, /workflow === "image_to_video"/, "Cost route must branch for image-to-video workflow.");
assert.match(costRouteSource, /createStudioInputImageHandoffs/, "Cost route must create image handoffs server-side.");
assert.match(costRouteSource, /inputs:[\s\S]*images: handoffImages/, "Cost route must send inputs.images to Hermes.");
assert.match(costRouteSource, /validationModelForWorkflow[\s\S]*disabled_until_upload[\s\S]*enablement: "guarded"/, "Cost route must allow disabled_until_upload models after an image input is selected.");
assert.match(jobsRouteSource, /Upload an image to generate image-to-video\./, "Jobs route must block image-to-video without an image.");
assert.match(jobsRouteSource, /supportsStudioWorkflow/, "Jobs route must validate image-to-video model capability through the shared workflow gate.");
assert.match(jobsRouteSource, /validationModelForWorkflow[\s\S]*disabled_until_upload[\s\S]*enablement: "guarded"/, "Jobs route must allow disabled_until_upload models after an image input is selected.");
assert.match(dispatcherSource, /createStudioJobInputImageHandoffs/, "Dispatcher must load input image assets before execute.");
assert.match(dispatcherSource, /workflow === "image_to_video"/, "Dispatcher must branch on image-to-video workflow.");
assert.match(uiSource, /inputAssetIds: workflow === "image_to_video"/, "UI must send selected image asset id for image-to-video.");
assert.match(uiSource, /validationModelForWorkflow[\s\S]*disabled_until_upload[\s\S]*enablement: "guarded"/, "Studio UI must not keep disabled_until_upload models blocked after image input is selected.");

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": resolve(root, "src"), "server-only": resolve(root, "scripts/server-only-noop.cjs") },
});
const { buildHermesVideoExecuteRequest } = await jiti.import(resolve(root, "src/lib/cmo/studio-dispatcher.ts"));
const { supportsStudioWorkflow, studioModelSupportsWorkflowOperation } = await jiti.import(resolve(root, "src/lib/cmo/studio-model-catalog.ts"));
const optionalImageModel = {
  id: "seedance_2_0",
  uiId: "seedance_2_0",
  providerModelId: "seedance_2_0",
  name: "Seedance 2.0",
  providerLabel: "Higgsfield",
  maxResolution: "720p",
  supportedResolutions: ["720p"],
  minDurationSeconds: 4,
  maxDurationSeconds: 15,
  supportsAudio: false,
  badges: [],
  costSupported: true,
  realVideoSupported: false,
  enablement: "safe_now",
  operations: ["text_to_video", "image_to_video"],
  inputsRequired: ["prompt"],
  inputsOptional: ["start_image"],
  canGenerateTextToVideo: true,
  canGenerateImageToVideo: false,
};
const needsSmokeOptionalImageModel = {
  ...optionalImageModel,
  id: "kling3_0_turbo",
  uiId: "kling3_0_turbo",
  providerModelId: "kling3_0_turbo",
  name: "Kling 3.0 Turbo",
  enablement: "needs_smoke",
};
const textOnlyModel = {
  ...optionalImageModel,
  id: "text_only",
  uiId: "text_only",
  providerModelId: "text_only",
  operations: ["text_to_video"],
  inputsOptional: [],
};

assert.equal(supportsStudioWorkflow(optionalImageModel, "image_to_video", { hasImageInput: true }), true, "Seedance optional start_image catalog shape must not be blocked for image-to-video.");
assert.equal(supportsStudioWorkflow(needsSmokeOptionalImageModel, "image_to_video", { hasImageInput: true }), true, "needs_smoke image-to-video models must warn only, not hard block.");
assert.equal(supportsStudioWorkflow(optionalImageModel, "image_to_video", { hasImageInput: false }), false, "Image-to-video must require a selected Product image input.");
assert.equal(studioModelSupportsWorkflowOperation(textOnlyModel, "image_to_video"), false, "Models without image_to_video operation must be blocked.");
assert.equal(supportsStudioWorkflow(optionalImageModel, "text_to_video"), true, "Text-to-video must continue to pass for optional image models.");

const imageInput = {
  asset_id: "studio_asset_input_001",
  role: "start_image",
  download_url: "https://product.example.test/storage/v1/object/sign/cmo-studio-assets/input.png?token=redacted",
  mime_type: "image/png",
  bytes: 123456,
  sha256: "a".repeat(64),
  filename: "product.png",
};
const payload = buildHermesVideoExecuteRequest({
  id: "studio_job_i2v_contract",
  tenant_id: "tenant_contract",
  created_by: "tester",
  status: "running",
  media_kind: "video",
  agent: "video",
  backend: "higgsfield",
  operation: "generate_video",
  context_json: { workflow: "image_to_video" },
  prompt: "Animate the product image.",
  negative_prompt: null,
  model_json: {
    product_model_id: "kling-image",
    ui_id: "kling-image",
    provider_model_id: "kling_i2v",
    name: "Kling Image",
    enablement: "disabled_until_upload",
    workflow: "image_to_video",
    operations: ["image_to_video"],
    inputs_required: ["prompt", "start_image"],
    can_generate_image_to_video: true,
    settings_schema: {
      duration: { min: 5, max: 5, default: 5 },
      aspect_ratio: { default: "16:9", values: ["16:9"] },
      resolution: { default: "720p", values: ["720p"] },
      mode: { default: null, values: [] },
      bitrate_mode: { default: null, values: [] },
    },
    constraints: [],
  },
  settings_json: {
    workflow: "image_to_video",
    durationSeconds: 5,
    aspectRatio: "16:9",
    resolution: "720p",
    bitrate: "standard",
    variants: 1,
  },
  input_asset_ids: ["studio_asset_input_001"],
  output_asset_ids: [],
  cost_json: { mode: "hermes", estimateAvailable: true, credits: 7.5, estimatedCredits: 7.5 },
  provider_job_id: null,
  provider_status: null,
  error_json: null,
  diagnostics_json: {},
  request_id: "debug_i2v_execute_001",
  dispatch_attempts: 1,
  dispatch_started_at: null,
  locked_until: null,
  created_at: "2026-06-30T00:00:00.000Z",
  started_at: "2026-06-30T00:00:00.000Z",
  completed_at: null,
  updated_at: "2026-06-30T00:00:00.000Z",
}, [imageInput]);

assert.equal(payload.workflow, "image_to_video");
assert.deepEqual(payload.inputs, {
  images: [imageInput],
  videos: [],
  audio: [],
});
assert.equal(payload.settings.bitrate, undefined, "Unsupported bitrate must be omitted.");
assert.equal(payload.settings.mode, undefined, "Unsupported mode must be omitted.");
assert.equal(JSON.stringify(payload).includes("base64"), false);
assert.equal(JSON.stringify(payload).includes("C:\\Users"), false);

console.log("Studio image-to-video contract check passed.");
