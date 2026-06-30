import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hermesClientSource = readFileSync("src/lib/cmo/studio/hermes-video-client.ts", "utf8");
const costRouteSource = readFileSync("src/app/api/cmo/studio/cost/estimate/route.ts", "utf8");
const dispatcherSource = readFileSync("src/lib/cmo/studio-dispatcher.ts", "utf8");
const assetSource = readFileSync("src/lib/cmo/studio-asset-ingest.ts", "utf8");

assert.match(hermesClientSource, /workflow\?: "text_to_video" \| "image_to_video"/, "Hermes client cost contract must support workflow.");
assert.match(hermesClientSource, /HermesVideoInputImage/, "Hermes client must type image handoff payloads.");
assert.match(costRouteSource, /workflow,[\s\S]*backend: "higgsfield"[\s\S]*model:[\s\S]*provider_model_id: providerModelId/, "Cost payload must include workflow and provider model id.");
assert.match(costRouteSource, /inputs:[\s\S]*images: handoffImages[\s\S]*videos: \[\][\s\S]*audio: \[\]/, "Cost payload must include image inputs and empty video/audio arrays.");
assert.match(dispatcherSource, /inputs:[\s\S]*images: inputImages[\s\S]*videos: \[\][\s\S]*audio: \[\]/, "Execute payload must include image inputs and empty video/audio arrays.");
assert.match(dispatcherSource, /model\.supportedBitrates\?\.length \? \{ bitrate/, "Dispatcher must omit unsupported bitrate settings.");
assert.match(assetSource, /createSignedUrl\(asset\.storage_key, 5 \* 60\)/, "Hermes handoff URLs must be short-lived.");
assert.doesNotMatch(costRouteSource + dispatcherSource + assetSource, /bytesBase64|data:image|file:\/\//, "Image-to-video payloads must not use base64 or local file URLs.");
assert.doesNotMatch(costRouteSource + dispatcherSource, /CMO_HERMES_VIDEO_AGENT_API_KEY|API_SERVER_KEY/, "Product API routes must not expose Hermes/API secrets.");

console.log("Studio Hermes image-to-video check passed.");
