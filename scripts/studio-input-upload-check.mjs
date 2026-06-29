import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uiSource = readFileSync("src/components/cmo-apps/studio-view.tsx", "utf8");
const assetSource = readFileSync("src/lib/cmo/studio-asset-ingest.ts", "utf8");
const initRouteSource = readFileSync("src/app/api/cmo/studio/assets/ingest/init/route.ts", "utf8");
const uploadRouteSource = readFileSync("src/app/api/cmo/studio/assets/ingest/upload/[sessionId]/route.ts", "utf8");
const completeRouteSource = readFileSync("src/app/api/cmo/studio/assets/ingest/complete/route.ts", "utf8");
const jobsRouteSource = readFileSync("src/app/api/cmo/studio/jobs/route.ts", "utf8");
const dispatcherSource = readFileSync("src/lib/cmo/studio-dispatcher.ts", "utf8");

assert.match(assetSource, /STUDIO_ALLOWED_MIME_TYPES[\s\S]*video\/mp4[\s\S]*video\/webm[\s\S]*image\/png[\s\S]*image\/jpeg[\s\S]*image\/webp/, "Input ingest must allow initial image/video MIME types.");
assert.match(assetSource, /purpose: StudioAssetPurpose/, "Upload sessions must preserve asset purpose.");
assert.match(assetSource, /studio_input/, "Asset ingest must support studio_input assets.");
assert.match(assetSource, /input_asset_ids/, "Completed input uploads must update job input_asset_ids.");
assert.match(initRouteSource, /createStudioAssetUploadSession/, "Init route must create Product upload sessions.");
assert.match(uploadRouteSource, /uploadStudioAssetSessionBytes/, "Upload route must store bytes server-side.");
assert.match(completeRouteSource, /completeStudioAssetUpload/, "Complete route must create studio_assets rows.");
assert.match(uiSource, /accept="image\/png,image\/jpeg,image\/webp,video\/mp4,video\/webm"/, "Studio UI must accept the supported input MIME types.");
assert.match(uiSource, /\/api\/cmo\/studio\/assets\/ingest\/init/, "Studio UI must call Product input upload init route.");
assert.match(uiSource, /\/api\/cmo\/studio\/assets\/ingest\/complete/, "Studio UI must call Product input upload complete route.");
assert.match(uiSource, /purpose: "studio_input"/, "Studio UI uploads must create studio_input assets.");
assert.match(uiSource, /selectedInputAssets/, "Studio UI must keep selected input asset state.");
assert.match(uiSource, /inputAssetIds: selectedInputAssets\.map/, "Studio UI must persist selected input asset IDs when creating jobs.");
assert.match(jobsRouteSource, /inputAssetIdsFromBody/, "Jobs route must accept input asset IDs.");
assert.match(dispatcherSource, /images: \[\][\s\S]*videos: \[\][\s\S]*audio: \[\]/, "Hermes v2.1 must not send input assets to Hermes yet.");
assert.doesNotMatch(uiSource, /CMO_HERMES|API_SERVER_KEY|\/agents\/video/, "Browser upload UI must not expose Hermes or server secrets.");

console.log("Studio input upload check passed.");
