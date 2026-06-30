import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/202606300001_studio_image_to_video_inputs.sql", "utf8");
const assetSource = readFileSync("src/lib/cmo/studio-asset-ingest.ts", "utf8");
const initRouteSource = readFileSync("src/app/api/cmo/studio/assets/ingest/init/route.ts", "utf8");
const uiSource = readFileSync("src/components/cmo-apps/studio-view.tsx", "utf8");

assert.match(migration, /alter column job_id drop not null/, "Image-to-video migration must allow pre-job input upload rows.");
assert.match(migration, /job_id is not null or purpose = 'studio_input'/, "Migration must keep output assets job-linked while allowing pre-job inputs.");
assert.match(migration, /tenant_id text/, "Pre-job input assets must carry tenant scope.");
assert.match(assetSource, /Pre-job Studio uploads are only supported for input images\./, "Pre-job uploads must be limited to input images.");
assert.match(assetSource, /createStudioInputImageHandoffs/, "Asset helper must create server-side image handoff URLs.");
assert.match(assetSource, /createStudioJobInputImageHandoffs/, "Dispatcher must be able to create job-scoped image handoffs.");
assert.match(assetSource, /\.createSignedUrl\(asset\.storage_key, 5 \* 60\)/, "Input handoff URLs must be short-lived.");
assert.match(initRouteSource, /jobId: stringValue\(body\.jobId/, "Init route must accept optional jobId.");
assert.match(uiSource, /workflow === "image_to_video"/, "Studio UI must expose image-to-video workflow state.");
assert.match(uiSource, /accept="image\/png,image\/jpeg,image\/webp"/, "Image-to-video input upload must accept image MIME types.");
assert.doesNotMatch(uiSource, /disabled=\{!activeJob \|\| isUploadingInput\}/, "Image input upload must not require an active Studio job.");
assert.doesNotMatch(assetSource, /bytesBase64|base64/, "Image input handoff must not use base64 JSON media.");
assert.doesNotMatch(uiSource, /CMO_HERMES|API_SERVER_KEY|\/agents\/video/, "Browser UI must not expose Hermes details.");

console.log("Studio image input upload check passed.");
