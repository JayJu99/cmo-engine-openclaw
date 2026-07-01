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
  "src/app/studio/page.tsx",
  "src/components/cmo-apps/studio-view.tsx",
  "src/app/api/cmo/studio/jobs/route.ts",
  "src/app/api/cmo/studio/jobs/[jobId]/route.ts",
  "src/app/api/cmo/studio/jobs/[jobId]/cancel/route.ts",
  "src/app/api/cmo/studio/cost/estimate/route.ts",
  "src/app/api/cmo/studio/assets/ingest/init/route.ts",
  "src/app/api/cmo/studio/assets/ingest/upload/[sessionId]/route.ts",
  "src/app/api/cmo/studio/assets/ingest/complete/route.ts",
  "src/lib/cmo/studio-job-service.ts",
  "src/lib/cmo/studio-asset-ingest.ts",
  "src/lib/cmo/studio-dispatcher.ts",
  "src/lib/cmo/studio-model-catalog.ts",
  "supabase/migrations/202606260001_studio_product_foundation.sql",
];

for (const file of requiredFiles) {
  assertExists(file);
}

const nav = read("src/components/dashboard/data.ts");
const studioPage = read("src/app/studio/page.tsx");
const studioView = read("src/components/cmo-apps/studio-view.tsx");
const jobService = read("src/lib/cmo/studio-job-service.ts");
const ingest = read("src/lib/cmo/studio-asset-ingest.ts");
const catalog = read("src/lib/cmo/studio-model-catalog.ts");
const migration = read("supabase/migrations/202606260001_studio_product_foundation.sql");

assert(nav.includes('{ label: "Studio", href: "/studio"') && nav.includes('icon: "Sparkles"'), "Studio must be a top-level sidebar item.");
assert(studioPage.includes("CMO_STUDIO_IMAGE_MODE_ENABLED"), "Studio page must pass the image-mode feature flag.");
assert(studioView.includes("Create Video"), "Create Video tab is missing.");
assert(studioView.includes("Edit Video") && studioView.includes("Motion Control"), "Disabled video mode tabs are missing.");
assert(studioView.includes("Coming Soon"), "Image mode must render as Coming Soon when enabled.");
assert(studioView.includes("/api/cmo/studio/jobs"), "Studio UI must create or poll Product Studio jobs.");
assert(studioView.includes("/api/cmo/studio/cost/estimate"), "Studio UI must use Product cost estimate route.");
assert(!studioView.match(/fetch\([^)]*Hermes|CMO_HERMES|\/agents\/video|\/agents\/studio/i), "Browser Studio UI must not call Hermes or agent routes.");

assert(jobService.includes('draft: ["queued"]'), "Status transition guard must include draft -> queued.");
assert(jobService.includes('queued: ["running", "cancelled"]'), "Status transition guard must include queued transitions.");
assert(jobService.includes('running: ["completed", "failed", "cancelled"]'), "Status transition guard must include running transitions.");
assert(jobService.includes("studio_prompt_required"), "Job API/service must validate required prompt.");
assert(jobService.includes("request_id"), "Job service must include request-level idempotency.");
assert(jobService.includes("product_mock"), "Job service must include mock runner diagnostics.");
assert(!jobService.includes("vault") && !jobService.includes("memory"), "Studio job service must not write Vault or memory state.");

assert(ingest.includes("assertStudioJobExists"), "Asset ingest must validate job id exists.");
assert(ingest.includes("studio_asset_unsupported_mime"), "Asset ingest must reject unsupported MIME types.");
assert(ingest.includes("storage_key"), "Asset ingest must persist storage_key as source of truth.");
assert(!ingest.includes("bytesBase64"), "Studio ingest must not transfer media as base64 JSON.");

for (const model of [
  "Seedance 2.0 Mini",
  "Enhanced Seedance 2.0 Fast",
  "Seedance 2.0",
  "Seedance 2.0 Fast",
  "Kling 3.0",
  "Kling 3.0 Turbo",
  "Kling 3.0 Motion Control",
  "HappyHorse",
  "Grok Imagine",
  "Grok Imagine 1.5",
  "Google Veo 3.1 Lite",
  "Wan 2.7",
]) {
  assert(catalog.includes(model), `Model catalog missing ${model}.`);
}

for (const table of ["studio_generation_jobs", "studio_asset_upload_sessions", "studio_assets"]) {
  assert(migration.includes(`create table if not exists public.${table}`), `Migration missing ${table}.`);
  assert(migration.includes(`alter table public.${table} enable row level security`), `Migration must enable RLS on ${table}.`);
}

assert(migration.includes("status in ('draft', 'queued', 'running', 'completed', 'failed', 'cancelled')"), "Migration missing Studio job status check.");
assert(migration.includes("media_kind in ('video', 'image')"), "Migration missing media_kind check.");
assert(migration.includes("backend in ('higgsfield', 'codex-imagen')"), "Migration missing backend check.");
assert(!existsSync(join(root, "src/app/apps/[appId]/studio")) && !existsSync(join(root, "src/app/api/cmo/apps/[appId]/studio")), "App-scoped Studio route must not exist.");

if (failures.length) {
  console.error("Studio foundation contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Studio foundation contract check passed.");
