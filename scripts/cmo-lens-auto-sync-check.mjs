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

async function assertAutoSyncRouteAuth() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-lens-auto-sync-route-"));
  const routeSource = repoPath("src", "app", "api", "internal", "lens", "metrics", "auto-sync", "route.ts");

  try {
    await writeFile(
      path.join(tmpDir, "lens-auto-sync.js"),
      `exports.calls = [];
exports.runProductLensAutoSync = async (input) => {
  exports.calls.push(input);
  return {
    schema_version: "product.lens_auto_sync_result.v1",
    trigger: input.trigger,
    mode: input.mode,
    status: "completed",
    started_at: "2026-06-17T00:00:00.000Z",
    completed_at: "2026-06-17T00:00:01.000Z",
    range_keys: input.rangeKeys,
    workspaces: [],
    summary: { workspace_count: 0, range_count: input.rangeKeys.length, synced_count: 0, failed_count: 0, skipped_count: 0 },
    safety: { no_tokens_returned: true, raw_ga4_response_included: false, vault_write_performed: false, gbrain_used: false, hermes_called: false },
  };
};\n`,
      "utf8",
    );
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
      path.join(tmpDir, "workspace-metric-snapshots.js"),
      `exports.isWorkspaceGa4MetricRangeKey = (value) => ["this_week", "last_7_days", "last_30_days", "this_month"].includes(value);\n`,
      "utf8",
    );
    await transpile(routeSource, path.join(tmpDir, "route.js"));

    const requireFromTmp = createRequire(path.join(tmpDir, "route.js"));
    const route = requireFromTmp(path.join(tmpDir, "route.js"));
    const autoSync = requireFromTmp(path.join(tmpDir, "lens-auto-sync.js"));
    const previousKey = process.env.CMO_LENS_INTERNAL_API_KEY;

    try {
      delete process.env.CMO_LENS_INTERNAL_API_KEY;
      let response = await route.POST(new Request("http://local/api/internal/lens/metrics/auto-sync", { method: "POST" }));
      strictAssert.equal(response.status, 401, "missing configured key must fail closed");

      process.env.CMO_LENS_INTERNAL_API_KEY = "internal-test-key";
      response = await route.POST(new Request("http://local/api/internal/lens/metrics/auto-sync", { method: "POST" }));
      strictAssert.equal(response.status, 401, "missing bearer token must be rejected");

      response = await route.POST(new Request("http://local/api/internal/lens/metrics/auto-sync", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-key" },
      }));
      strictAssert.equal(response.status, 401, "wrong bearer token must be rejected");

      response = await route.POST(new Request("http://local/api/internal/lens/metrics/auto-sync", {
        method: "POST",
        headers: {
          Authorization: "Bearer internal-test-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appIds: ["holdstation-mini-app"],
          rangeKeys: ["this_week", "not_a_range"],
          mode: "refresh_if_stale",
          trigger: "hourly",
          dryRun: true,
        }),
      }));
      strictAssert.equal(response.status, 200, "correct bearer token must be accepted");

      const payload = await response.json();
      strictAssert.equal(payload.schema_version, "product.lens_auto_sync_result.v1");
      strictAssert.equal(payload.mode, "dryRun");
      strictAssert.equal(payload.trigger, "hourly");
      strictAssert.deepEqual(payload.range_keys, ["this_week"]);
      strictAssert.equal(payload.safety.no_tokens_returned, true);
      strictAssert.equal(payload.safety.raw_ga4_response_included, false);
      strictAssert.equal(payload.safety.vault_write_performed, false);
      strictAssert.equal(payload.safety.gbrain_used, false);
      strictAssert.equal(payload.safety.hermes_called, false);
      strictAssert.ok(!JSON.stringify(payload).match(/access_token|refresh_token|encrypted_refresh_token|id_token/i), "auto-sync payload must not expose tokens");
      strictAssert.deepEqual(autoSync.calls.at(-1), {
        appIds: ["holdstation-mini-app"],
        rangeKeys: ["this_week"],
        mode: "dryRun",
        trigger: "hourly",
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

const routePath = "src/app/api/internal/lens/metrics/auto-sync/route.ts";
const helperPath = "src/lib/cmo/lens-auto-sync.ts";
const internalAuthPath = "src/lib/cmo/lens-internal-auth.ts";
const dashboardPath = "src/components/cmo-apps/app-workspace-view.tsx";
const contextHelperPath = "src/lib/cmo/lens-readout-context.ts";
const envExamplePath = ".env.example";
const migrationPath = "supabase/migrations/202606170001_workspace_metric_sync_runs.sql";
const servicePath = "ops/systemd/cmo-lens-hourly-sync.service";
const timerPath = "ops/systemd/cmo-lens-hourly-sync.timer";

for (const file of [routePath, helperPath, internalAuthPath, dashboardPath, contextHelperPath, envExamplePath, migrationPath, servicePath, timerPath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(routePath, "POST(request: Request)", "Auto-sync route must expose POST");
assertIncludes(routePath, "authorizeLensInternalRequest", "Auto-sync route must use internal bearer auth");
assertIncludes(internalAuthPath, "CMO_LENS_INTERNAL_API_KEY", "Internal auth helper must require CMO_LENS_INTERNAL_API_KEY");
assertIncludes(routePath, "runProductLensAutoSync", "Auto-sync route must call Product auto-sync helper");
assertIncludes(routePath, '"refresh_if_stale"', "Auto-sync route must support refresh_if_stale");
assertIncludes(routePath, '"refresh_all"', "Auto-sync route must support refresh_all");
assertIncludes(routePath, '"dryRun"', "Auto-sync route must support dryRun");
assertExcludes(routePath, /requireRequestUserIfAuthRequired|cookies\(|next\/headers/i, "Auto-sync route must not use frontend auth or cookies");

assertIncludes(helperPath, 'schema_version: "product.lens_auto_sync_result.v1"', "Auto-sync helper must emit safe result contract");
assertIncludes(helperPath, "requireWorkspaceRegistryEntry(appId)", "Requested appIds must resolve through workspace registry");
assertIncludes(helperPath, "workspaceRegistry", "Omitted appIds must scan registered workspaces");
assertIncludes(helperPath, "getWorkspaceGa4MetricSourceMapping", "Auto-sync helper must read GA4 source mappings");
assertIncludes(helperPath, "getLatestWorkspaceGa4MetricSnapshot", "Auto-sync helper must read latest snapshots");
assertIncludes(helperPath, "fetchLensGa4CoreMetrics", "Auto-sync helper must use Product GA4 helper flow");
assertIncludes(helperPath, "upsertWorkspaceGa4MetricSnapshot", "Auto-sync helper must write Supabase snapshots");
assertIncludes(helperPath, "verificationStatus === \"verified\"", "Auto-sync helper must only sync verified GA4 mappings");
assertMatches(helperPath, /autoSyncStaleThresholdHours[\s\S]{0,180}\?\s*2\s*:\s*1/, "Auto-sync stale thresholds must be 1h short ranges and 2h long ranges");
assertIncludes(helperPath, 'input.mode === "refresh_all"', "refresh_all must sync requested ranges regardless of freshness");
assertIncludes(helperPath, 'input.mode === "dryRun"', "dryRun branch must exist");

const helperSource = source(helperPath);
const dryRunStart = helperSource.indexOf('if (input.mode === "dryRun")');
const dryRunEnd = helperSource.indexOf('} else if (!shouldSync)', dryRunStart);
assert(dryRunStart >= 0 && dryRunEnd > dryRunStart, "dryRun branch could not be located");
const dryRunBlock = helperSource.slice(dryRunStart, dryRunEnd);
assert(!/syncRange\(|fetchLensGa4CoreMetrics|upsertWorkspaceGa4MetricSnapshot/.test(dryRunBlock), "dryRun must not call GA4 or write snapshots");

assertIncludes(helperPath, "raw_ga4_response_included: false", "Auto-sync result must not include raw GA4 responses");
assertIncludes(helperPath, "no_tokens_returned: true", "Auto-sync result must assert no tokens returned");
assertIncludes(helperPath, "vault_write_performed: false", "Auto-sync result must assert no Vault writes");
assertIncludes(helperPath, "gbrain_used: false", "Auto-sync result must assert no GBrain use");
assertIncludes(helperPath, "hermes_called: false", "Auto-sync result must assert no Hermes calls");
assertExcludes(helperPath, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\b/i, "Auto-sync helper must not expose token fields");
assertExcludes(helperPath, /\/agents\/|runHermes|callHermes|hermes-cmo-runtime|importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain|queryGBrain|callGBrain/i, "Auto-sync helper must not call Hermes or GBrain");
assertExcludes(helperPath, /final\s+answer|answer\s*=/i, "Auto-sync helper must not synthesize final CMO answers");

assertIncludes(migrationPath, "create table if not exists public.workspace_metric_sync_runs", "Sync run migration must create workspace_metric_sync_runs");
assertExcludes(migrationPath, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\b/i, "Sync run table must not contain token fields");

assertIncludes(dashboardPath, "Source: Lens GA4", "Dashboard must keep Lens GA4 source label");
assertIncludes(dashboardPath, "Auto sync: hourly", "Dashboard must show hourly auto sync text");
assertIncludes(dashboardPath, "Last synced:", "Dashboard must show latest synced timestamp");
assertIncludes(dashboardPath, "Sync GA4 metrics", "Dashboard must keep manual sync button");
assertMatches(dashboardPath, /label:\s*"New Users"[\s\S]{0,220}compactMetricValue\(newUsers\)/, "New Users card must map from GA4 newUsers");
assertMatches(dashboardPath, /label:\s*"Sessions"[\s\S]{0,240}ga4MetricSnapshot\?\.metrics\.sessions/, "Sessions card must map from GA4 sessions");
assertMatches(dashboardPath, /label:\s*"Event Count"[\s\S]{0,240}ga4MetricSnapshot\?\.metrics\.eventCount/, "Event Count card must map from GA4 eventCount");
assertMatches(dashboardPath, /label:\s*"Engagement Rate"[\s\S]{0,260}ga4MetricSnapshot\?\.metrics\.engagementRate/, "Engagement Rate card must map from GA4 engagementRate");
assertMatches(dashboardPath, /Requires activation\/retention definition\./, "Activation and retention cards must remain definition_needed");
assertMatches(dashboardPath, /Metric definition needed/, "Definition-needed badge must remain");
assertExcludes(dashboardPath, /Activated Users[\s\S]{0,800}activeUsers|activeUsers[\s\S]{0,800}Activated Users/, "activeUsers must not be displayed as Activated Users");
assertExcludes(dashboardPath, /Activation Rate[\s\S]{0,800}engagementRate|engagementRate[\s\S]{0,800}Activation Rate/, "engagementRate must not be displayed as Activation Rate");
assertExcludes(dashboardPath, /D1 Retention[\s\S]{0,800}ga4MetricSnapshot|D7 Retention[\s\S]{0,800}ga4MetricSnapshot/, "D1/D7 retention must not be populated from GA4 snapshots");

assertIncludes(contextHelperPath, "process.env.CMO_LENS_DIRECT_CONTEXT_ENABLED === \"true\"", "Direct Lens context injection must remain default off");
assertIncludes(envExamplePath, "CMO_LENS_DIRECT_CONTEXT_ENABLED=false", "Env example must keep direct Lens context disabled by default");

assertIncludes(servicePath, "http://127.0.0.1:3002/api/internal/lens/metrics/auto-sync", "Systemd service must call local auto-sync route");
assertIncludes(servicePath, "/home/ju/.config/cmo-engine-openclaw/dashboard.env", "Systemd service must use dashboard env file");
assertIncludes(servicePath, "CMO_LENS_INTERNAL_API_KEY", "Systemd service must use internal key env var");
assertExcludes(servicePath, /sk-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9_-]{12,}/, "Systemd service must not hardcode secrets");
assertIncludes(timerPath, "OnCalendar=hourly", "Systemd timer must run hourly");
assertIncludes(timerPath, "Persistent=true", "Systemd timer must be persistent");

await assertAutoSyncRouteAuth();

console.log("CMO Lens auto-sync check passed.");
