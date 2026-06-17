import strictAssert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();

function repoPath(...segments) {
  return path.join(root, ...segments);
}

function source(relativePath) {
  return fs.readFileSync(repoPath(relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFileExists(relativePath, message) {
  assert(fs.existsSync(repoPath(relativePath)), message);
}

function assertIncludes(relativePath, expected, message) {
  assert(source(relativePath).includes(expected), message);
}

function assertMatches(relativePath, pattern, message) {
  assert(pattern.test(source(relativePath)), message);
}

function assertExcludes(relativePath, pattern, message) {
  assert(!pattern.test(source(relativePath)), message);
}

async function transpile(sourcePath, outputPath) {
  const output = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText.replace(/require\("@\/lib\/cmo\/([^"]+)"\)/g, (_match, modulePath) =>
    `require("./${path.basename(modulePath)}.js")`
  );

  await writeFile(outputPath, output, "utf8");
}

async function assertDeepSyncRoutesAuth() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-lens-daily-deep-sync-route-"));
  const deepSyncRouteSource = repoPath("src", "app", "api", "internal", "lens", "metrics", "deep-sync", "route.ts");
  const reportPacksRouteSource = repoPath("src", "app", "api", "internal", "lens", "apps", "[appId]", "ga4", "report-packs", "route.ts");

  try {
    await writeFile(
      path.join(tmpDir, "lens-internal-auth.js"),
      `const { timingSafeEqual } = require("crypto");
function token(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\\s+(.+)$/i);
  return match && match[1] ? match[1].trim() : null;
}
exports.authorizeLensInternalRequest = (request) => {
  const configured = (process.env.CMO_LENS_INTERNAL_API_KEY || "").trim();
  const incoming = token(request);
  const ok = configured && incoming && Buffer.byteLength(configured) === Buffer.byteLength(incoming) && timingSafeEqual(Buffer.from(configured), Buffer.from(incoming));
  return ok ? null : Response.json({ error: "Unauthorized.", code: "unauthorized" }, { status: 401 });
};\n`,
      "utf8",
    );
    await writeFile(
      path.join(tmpDir, "lens-ga4-deep-sync.js"),
      `exports.calls = { sync: [], read: [] };
exports.normalizeProductLensDeepSyncRangeKeys = (value) => {
  const allowed = ["yesterday", "this_week", "last_7_days", "last_30_days"];
  const list = Array.isArray(value) ? value.filter((item) => allowed.includes(item)) : [];
  return list.length ? [...new Set(list)] : ["yesterday", "this_week", "last_7_days", "last_30_days"];
};
exports.normalizeProductLensDeepSyncPackKeys = (value) => {
  const allowed = ["core_summary", "acquisition_channel", "source_medium", "campaign", "top_events", "top_pages_screens", "geo_country", "device_category", "platform", "key_events"];
  const list = Array.isArray(value) ? value.filter((item) => allowed.includes(item)) : [];
  return list.length ? [...new Set(list)] : ["core_summary", "acquisition_channel", "source_medium", "campaign", "top_events", "top_pages_screens", "geo_country", "device_category", "platform"];
};
exports.normalizeProductLensDeepSyncMode = (body) => body && body.dryRun === true ? "dryRun" : body && body.mode === "refresh_all" ? "refresh_all" : "refresh_if_missing";
exports.runProductLensDailyDeepSync = async (input) => {
  exports.calls.sync.push(input);
  return {
    schema_version: "product.lens_deep_sync_result.v1",
    trigger: input.trigger,
    mode: input.mode,
    status: "completed",
    started_at: "2026-06-18T00:00:00.000Z",
    completed_at: "2026-06-18T00:00:01.000Z",
    range_keys: input.rangeKeys,
    pack_keys: input.packKeys,
    workspaces: [],
    summary: { workspace_count: 0, range_count: input.rangeKeys.length, pack_count: input.packKeys.length, synced_count: 0, failed_count: 0, skipped_count: 0 },
    safety: { no_tokens_returned: true, raw_ga4_response_included: false, vault_write_performed: false, gbrain_used: false, hermes_called: false },
  };
};
exports.getProductLensGa4ReportPacks = async (input) => {
  exports.calls.read.push(input);
  return {
    schema_version: "product.lens_ga4_report_packs.v1",
    status: "completed",
    tenant_id: "holdstation",
    workspace_id: "holdstation-mini-app",
    app_id: input.appId,
    range_key: input.rangeKey,
    packs: [],
    safety: { no_tokens_returned: true, raw_ga4_response_included: false, vault_write_performed: false, gbrain_used: false, hermes_called: false },
  };
};\n`,
      "utf8",
    );
    await transpile(deepSyncRouteSource, path.join(tmpDir, "deep-sync-route.js"));
    await transpile(reportPacksRouteSource, path.join(tmpDir, "report-packs-route.js"));

    const requireFromTmp = createRequire(path.join(tmpDir, "deep-sync-route.js"));
    const deepSyncRoute = requireFromTmp(path.join(tmpDir, "deep-sync-route.js"));
    const reportPacksRoute = requireFromTmp(path.join(tmpDir, "report-packs-route.js"));
    const helper = requireFromTmp(path.join(tmpDir, "lens-ga4-deep-sync.js"));
    const context = { params: Promise.resolve({ appId: "holdstation-mini-app" }) };
    const previousKey = process.env.CMO_LENS_INTERNAL_API_KEY;

    try {
      process.env.CMO_LENS_INTERNAL_API_KEY = "internal-test-key";

      let response = await deepSyncRoute.POST(new Request("http://local/api/internal/lens/metrics/deep-sync", { method: "POST" }));
      strictAssert.equal(response.status, 401, "deep-sync POST must reject missing bearer token");

      response = await reportPacksRoute.GET(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/report-packs"), context);
      strictAssert.equal(response.status, 401, "report-packs GET must reject missing bearer token");

      response = await deepSyncRoute.POST(new Request("http://local/api/internal/lens/metrics/deep-sync", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-key", "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      }));
      strictAssert.equal(response.status, 401, "deep-sync POST must reject wrong bearer token");

      response = await deepSyncRoute.POST(new Request("http://local/api/internal/lens/metrics/deep-sync", {
        method: "POST",
        headers: { Authorization: "Bearer internal-test-key", "Content-Type": "application/json" },
        body: JSON.stringify({
          appIds: ["holdstation-mini-app"],
          rangeKeys: ["yesterday", "not_a_range"],
          packKeys: ["core_summary", "not_a_pack"],
          mode: "refresh_all",
          trigger: "daily",
          dryRun: true,
        }),
      }));
      strictAssert.equal(response.status, 200, "deep-sync POST must accept correct bearer token");
      const deepPayload = await response.json();
      strictAssert.equal(deepPayload.schema_version, "product.lens_deep_sync_result.v1");
      strictAssert.equal(deepPayload.mode, "dryRun");
      strictAssert.deepEqual(deepPayload.range_keys, ["yesterday"]);
      strictAssert.deepEqual(deepPayload.pack_keys, ["core_summary"]);
      strictAssert.equal(deepPayload.safety.raw_ga4_response_included, false);
      strictAssert.equal(deepPayload.safety.vault_write_performed, false);
      strictAssert.equal(deepPayload.safety.gbrain_used, false);
      strictAssert.equal(deepPayload.safety.hermes_called, false);
      strictAssert.ok(!JSON.stringify(deepPayload).match(/access_token|refresh_token|encrypted_refresh_token|id_token/i), "deep sync response must not expose tokens");
      strictAssert.deepEqual(helper.calls.sync.at(-1), {
        appIds: ["holdstation-mini-app"],
        rangeKeys: ["yesterday"],
        packKeys: ["core_summary"],
        mode: "dryRun",
        trigger: "daily",
      });

      response = await reportPacksRoute.GET(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/report-packs?rangeKey=yesterday&packKeys=core_summary,top_events&latest=true", {
        headers: { Authorization: "Bearer internal-test-key" },
      }), context);
      strictAssert.equal(response.status, 200, "report-packs GET must accept correct bearer token");
      const readPayload = await response.json();
      strictAssert.equal(readPayload.schema_version, "product.lens_ga4_report_packs.v1");
      strictAssert.deepEqual(helper.calls.read.at(-1), {
        appId: "holdstation-mini-app",
        rangeKey: "yesterday",
        packKeys: ["core_summary", "top_events"],
        latest: true,
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.CMO_LENS_INTERNAL_API_KEY;
      } else {
        process.env.CMO_LENS_INTERNAL_API_KEY = previousKey;
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

const migrationPath = "supabase/migrations/202606180002_workspace_metric_report_packs.sql";
const helperPath = "src/lib/cmo/lens-ga4-deep-sync.ts";
const deepSyncRoutePath = "src/app/api/internal/lens/metrics/deep-sync/route.ts";
const reportPacksRoutePath = "src/app/api/internal/lens/apps/[appId]/ga4/report-packs/route.ts";
const internalAuthPath = "src/lib/cmo/lens-internal-auth.ts";
const autoSyncRoutePath = "src/app/api/internal/lens/metrics/auto-sync/route.ts";
const adHocRoutePath = "src/app/api/internal/lens/apps/[appId]/ga4/query/route.ts";
const dashboardPath = "src/components/cmo-apps/app-workspace-view.tsx";
const servicePath = "ops/systemd/cmo-lens-daily-deep-sync.service";
const timerPath = "ops/systemd/cmo-lens-daily-deep-sync.timer";

for (const file of [migrationPath, helperPath, deepSyncRoutePath, reportPacksRoutePath, internalAuthPath, autoSyncRoutePath, adHocRoutePath, dashboardPath, servicePath, timerPath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(migrationPath, "create table if not exists public.workspace_metric_report_packs", "Migration must create workspace_metric_report_packs");
assertIncludes(migrationPath, "workspace_metric_report_packs_unique_pack", "Migration must enforce unique report pack scope");
assertIncludes(migrationPath, "alter table public.workspace_metric_report_packs enable row level security", "Report packs table must enable RLS");
assertIncludes(migrationPath, "grant select, insert, update, delete on table public.workspace_metric_report_packs to service_role", "Report packs table must grant service_role Data API access");
assertExcludes(migrationPath, /\b(access_token|refresh_token|encrypted_refresh_token|id_token|raw_ga4_response|raw_google_response)\b/i, "Report packs migration must not contain token/raw GA4 columns");

assertIncludes(deepSyncRoutePath, "POST(request: Request)", "Daily deep sync route must expose POST");
assertIncludes(deepSyncRoutePath, "authorizeLensInternalRequest", "Daily deep sync route must use internal bearer auth");
assertIncludes(reportPacksRoutePath, "GET(request: Request", "Report packs route must expose GET");
assertIncludes(reportPacksRoutePath, "authorizeLensInternalRequest", "Report packs route must use internal bearer auth");
assertExcludes(deepSyncRoutePath, /requireRequestUserIfAuthRequired|cookies\(|next\/headers/i, "Daily deep sync route must not use frontend auth or cookies");
assertExcludes(reportPacksRoutePath, /requireRequestUserIfAuthRequired|cookies\(|next\/headers/i, "Report packs route must not use frontend auth or cookies");
assertIncludes(internalAuthPath, "CMO_LENS_INTERNAL_API_KEY", "Internal auth helper must require CMO_LENS_INTERNAL_API_KEY");

assertIncludes(helperPath, 'schema_version: "product.lens_deep_sync_result.v1"', "Deep sync helper must emit result contract");
assertIncludes(helperPath, 'schema_version: "product.lens_ga4_report_packs.v1"', "Report packs helper must emit read contract");
assertIncludes(helperPath, "workspace_metric_report_packs", "Helper must read/write report packs table");
assertIncludes(helperPath, "requireWorkspaceRegistryEntry(appId)", "Requested appIds must resolve through workspace registry");
assertIncludes(helperPath, "workspaceRegistry", "Omitted appIds must scan registered workspaces");
assertIncludes(helperPath, "getWorkspaceGa4MetricSourceMapping", "Helper must read Product GA4 source mapping");
assertIncludes(helperPath, "getLensGoogleAccessToken", "Helper must use existing Product GA4 auth/token flow");
assertIncludes(helperPath, "getProductLensGa4Catalog", "Helper must ensure metadata catalog exists");
assertIncludes(helperPath, "runProductLensGa4AdHocQuery", "Helper should reuse ad-hoc query path where possible");
assertIncludes(helperPath, 'trigger: result.trigger === "daily" ? "daily_deep_sync"', "Deep sync must reuse sync run logs with daily_deep_sync trigger");
assertIncludes(helperPath, "LENS_GA4_DAILY_DEEP_SYNC_DEFAULT_RANGE_KEYS", "Default range keys must be deterministic");
assertIncludes(helperPath, "LENS_GA4_DAILY_DEEP_SYNC_DEFAULT_PACK_KEYS", "Default pack keys must be deterministic");
for (const rangeKey of ["yesterday", "this_week", "last_7_days", "last_30_days"]) {
  assertIncludes(helperPath, `"${rangeKey}"`, `Default range ${rangeKey} missing`);
}
for (const packKey of ["core_summary", "acquisition_channel", "source_medium", "campaign", "top_events", "top_pages_screens", "geo_country", "device_category", "platform"]) {
  assertIncludes(helperPath, `"${packKey}"`, `Default pack ${packKey} missing`);
}
for (const metric of ["activeUsers", "newUsers", "sessions", "eventCount", "engagementRate", "screenPageViews", "userEngagementDuration", "keyEvents"]) {
  assertIncludes(helperPath, `"${metric}"`, `Pack metric ${metric} missing`);
}
for (const dimension of ["sessionDefaultChannelGroup", "sessionSourceMedium", "sessionCampaignName", "eventName", "unifiedPagePathScreen", "pagePath", "country", "deviceCategory", "platform"]) {
  assertIncludes(helperPath, `"${dimension}"`, `Pack dimension ${dimension} missing`);
}
assertMatches(helperPath, /packKey:\s*"top_pages_screens"[\s\S]{0,260}fallbackDimensions:\s*\[\["pagePath"\]\]/, "top_pages_screens must fallback to pagePath");
assertIncludes(helperPath, "pack_fields_unavailable", "Unavailable pack fields must skip pack instead of inventing metrics");
assertIncludes(helperPath, "try {", "Per-pack failures must be isolated");
assertMatches(helperPath, /for \(const packKey of input\.packKeys\)[\s\S]{0,2400}catch \(error\)/, "Per-pack failure must not fail whole job");
assertIncludes(helperPath, 'input.mode === "dryRun"', "dryRun branch must exist");

const helperSource = source(helperPath);
const dryRunStart = helperSource.indexOf('if (input.mode === "dryRun")');
const dryRunEnd = helperSource.indexOf('const queryHash = stableReportPackHash', dryRunStart);
assert(dryRunStart >= 0 && dryRunEnd > dryRunStart, "dryRun branch could not be located");
const dryRunBlock = helperSource.slice(dryRunStart, dryRunEnd);
assert(!/runProductLensGa4AdHocQuery|getLensGoogleAccessToken|runDirectReport/.test(dryRunBlock), "dryRun must not call GA4");

assertIncludes(helperPath, "raw_ga4_response_included: false", "Deep sync responses must not include raw GA4 response");
assertIncludes(helperPath, "no_tokens_returned: true", "Deep sync responses must assert no tokens returned");
assertIncludes(helperPath, "vault_write_performed: false", "Deep sync responses must assert no Vault writes");
assertIncludes(helperPath, "gbrain_used: false", "Deep sync responses must assert no GBrain use");
assertIncludes(helperPath, "hermes_called: false", "Deep sync responses must assert no Hermes calls");
assertExcludes(helperPath, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\s*:/i, "Deep sync helper must not expose token fields");
assertExcludes(helperPath, /\/agents\/|runHermes|callHermes|hermes-cmo-runtime|importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain|queryGBrain|callGBrain/i, "Deep sync helper must not call Hermes or GBrain");
assertExcludes(helperPath, /final\s+answer|answer\s*=/i, "Deep sync helper must not synthesize final CMO answers");

assertIncludes(autoSyncRoutePath, "runProductLensAutoSync", "M9A-1 auto-sync route must remain intact");
assertIncludes(autoSyncRoutePath, "authorizeLensInternalRequest", "M9A-1 auto-sync auth must remain intact");
assertIncludes(adHocRoutePath, "runProductLensGa4AdHocQuery", "M9B-1 ad-hoc query route must remain intact");
assertIncludes(adHocRoutePath, "ProductLensGa4ValidationError", "M9B-1 ad-hoc validation mapping must remain intact");

assertIncludes(dashboardPath, "Source: Lens GA4", "Dashboard must keep safe Lens GA4 source label");
assertMatches(dashboardPath, /Requires activation\/retention definition\./, "Activation/retention must remain definition_needed");
assertMatches(dashboardPath, /Metric definition needed/, "Definition-needed badge must remain");
assertExcludes(dashboardPath, /Activated Users[\s\S]{0,800}activeUsers|activeUsers[\s\S]{0,800}Activated Users/, "activeUsers must not become Activated Users");
assertExcludes(dashboardPath, /D1 Retention[\s\S]{0,800}ga4MetricSnapshot|D7 Retention[\s\S]{0,800}ga4MetricSnapshot/, "Retention must not be populated from GA4 snapshots");

assertIncludes(servicePath, "http://127.0.0.1:3002/api/internal/lens/metrics/deep-sync", "Systemd service must call local deep-sync route");
assertIncludes(servicePath, "/home/ju/.config/cmo-engine-openclaw/dashboard.env", "Systemd service must use dashboard env file");
assertIncludes(servicePath, "CMO_LENS_INTERNAL_API_KEY", "Systemd service must use internal key env var");
assertExcludes(servicePath, /sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9_-]{12,}/, "Systemd service must not hardcode secrets");
assertIncludes(timerPath, "OnCalendar=*-*-* 07:15:00 Asia/Ho_Chi_Minh", "Systemd timer must run at 07:15 Asia/Ho_Chi_Minh");
assertIncludes(timerPath, "Persistent=true", "Systemd timer must be persistent");

await assertDeepSyncRoutesAuth();

console.log("CMO Lens daily deep sync check passed.");
