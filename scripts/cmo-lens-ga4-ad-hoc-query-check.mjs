import { execFileSync } from "node:child_process";
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

async function assertInternalRouteAuth() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "cmo-lens-ga4-ad-hoc-route-"));
  const catalogRouteSource = repoPath("src", "app", "api", "internal", "lens", "apps", "[appId]", "ga4", "catalog", "route.ts");
  const catalogSyncRouteSource = repoPath("src", "app", "api", "internal", "lens", "apps", "[appId]", "ga4", "catalog", "sync", "route.ts");
  const queryRouteSource = repoPath("src", "app", "api", "internal", "lens", "apps", "[appId]", "ga4", "query", "route.ts");

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
      path.join(tmpDir, "lens-ga4-catalog.js"),
      `class ProductLensGa4ValidationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}
exports.ProductLensGa4ValidationError = ProductLensGa4ValidationError;
exports.calls = { catalog: [], sync: [], query: [] };
exports.productLensGa4ErrorCode = (error) => error && error.code ? error.code : "mock_error";
exports.getProductLensGa4Catalog = async (input) => {
  exports.calls.catalog.push(input);
  return {
    schema_version: "product.lens_ga4_catalog.v1",
    status: input.refreshIfMissing ? "synced" : "cached",
    tenant_id: "holdstation",
    workspace_id: "holdstation-mini-app",
    app_id: "holdstation-mini-app",
    source: { provider: "ga4", source_type: "ga4", source_id: "ga4_native", property_id: "487138147" },
    catalog: { metrics: [], dimensions: [] },
    synced_at: "2026-06-18T00:00:00.000Z",
    safety: { no_tokens_returned: true, raw_ga4_response_included: false, vault_write_performed: false, gbrain_used: false, hermes_called: false },
  };
};
exports.syncProductLensGa4Catalog = async (input) => {
  exports.calls.sync.push(input);
  return {
    schema_version: "product.lens_ga4_catalog.v1",
    status: "synced",
    tenant_id: "holdstation",
    workspace_id: "holdstation-mini-app",
    app_id: input.appId,
    source: { provider: "ga4", source_type: "ga4", source_id: "ga4_native", property_id: "487138147" },
    catalog: { metrics: [], dimensions: [] },
    synced_at: "2026-06-18T00:00:00.000Z",
    safety: { no_tokens_returned: true, raw_ga4_response_included: false, vault_write_performed: false, gbrain_used: false, hermes_called: false },
  };
};
exports.runProductLensGa4AdHocQuery = async (input) => {
  exports.calls.query.push(input);
  if (input.body.metrics && input.body.metrics.includes("badMetric")) {
    throw new ProductLensGa4ValidationError("unsupported_metric", "Unsupported metric: badMetric");
  }
  return {
    schema_version: "product.lens_ga4_query_result.v1",
    status: "completed",
    tenant_id: "holdstation",
    workspace_id: "holdstation-mini-app",
    app_id: input.appId,
    range: { key: "this_week", date_start: "2026-06-15", date_end: "2026-06-18", timezone: "Asia/Saigon" },
    query: { metrics: input.body.metrics, dimensions: input.body.dimensions || [], filters: [], orderBy: [], limit: input.body.limit || 10 },
    rows: [],
    totals: {},
    row_count: 0,
    source: { provider: "ga4", source_type: "ga4", source_id: "ga4_native", property_id: "487138147", cache: "miss", query_result_id: "query_1" },
    quality: { confidence: "high", warnings: [] },
    safety: { no_tokens_returned: true, raw_ga4_response_included: false, vault_write_performed: false, gbrain_used: false, hermes_called: false },
  };
};\n`,
      "utf8",
    );
    await transpile(catalogRouteSource, path.join(tmpDir, "catalog-route.js"));
    await transpile(catalogSyncRouteSource, path.join(tmpDir, "catalog-sync-route.js"));
    await transpile(queryRouteSource, path.join(tmpDir, "query-route.js"));

    const requireFromTmp = createRequire(path.join(tmpDir, "query-route.js"));
    const catalogRoute = requireFromTmp(path.join(tmpDir, "catalog-route.js"));
    const catalogSyncRoute = requireFromTmp(path.join(tmpDir, "catalog-sync-route.js"));
    const queryRoute = requireFromTmp(path.join(tmpDir, "query-route.js"));
    const helper = requireFromTmp(path.join(tmpDir, "lens-ga4-catalog.js"));
    const context = { params: Promise.resolve({ appId: "holdstation-mini-app" }) };
    const previousKey = process.env.CMO_LENS_INTERNAL_API_KEY;

    try {
      process.env.CMO_LENS_INTERNAL_API_KEY = "internal-test-key";

      let response = await catalogRoute.GET(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/catalog"), context);
      strictAssert.equal(response.status, 401, "catalog GET must reject missing bearer token");

      response = await catalogSyncRoute.POST(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/catalog/sync", { method: "POST" }), context);
      strictAssert.equal(response.status, 401, "catalog sync POST must reject missing bearer token");

      response = await queryRoute.POST(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/query", { method: "POST" }), context);
      strictAssert.equal(response.status, 401, "query POST must reject missing bearer token");

      response = await queryRoute.POST(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/query", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-key", "Content-Type": "application/json" },
        body: JSON.stringify({ metrics: ["newUsers"] }),
      }), context);
      strictAssert.equal(response.status, 401, "query POST must reject wrong bearer token");

      response = await catalogRoute.GET(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/catalog?refreshIfMissing=true", {
        headers: { Authorization: "Bearer internal-test-key" },
      }), context);
      strictAssert.equal(response.status, 200, "catalog GET must accept correct bearer token");
      strictAssert.deepEqual(helper.calls.catalog.at(-1), {
        appId: "holdstation-mini-app",
        refreshIfMissing: true,
      });

      response = await catalogSyncRoute.POST(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/catalog/sync", {
        method: "POST",
        headers: { Authorization: "Bearer internal-test-key" },
      }), context);
      strictAssert.equal(response.status, 200, "catalog sync POST must accept correct bearer token");
      strictAssert.deepEqual(helper.calls.sync.at(-1), { appId: "holdstation-mini-app" });

      response = await queryRoute.POST(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/query", {
        method: "POST",
        headers: { Authorization: "Bearer internal-test-key", "Content-Type": "application/json" },
        body: JSON.stringify({
          rangeKey: "this_week",
          metrics: ["newUsers", "sessions"],
          dimensions: ["sessionDefaultChannelGroup"],
          limit: 10,
        }),
      }), context);
      strictAssert.equal(response.status, 200, "query POST must accept correct bearer token");
      const payload = await response.json();
      strictAssert.equal(payload.schema_version, "product.lens_ga4_query_result.v1");
      strictAssert.ok(!JSON.stringify(payload).match(/access_token|refresh_token|encrypted_refresh_token|id_token/i), "query response must not expose tokens");
      strictAssert.deepEqual(helper.calls.query.at(-1).body.metrics, ["newUsers", "sessions"]);

      response = await queryRoute.POST(new Request("http://local/api/internal/lens/apps/holdstation-mini-app/ga4/query", {
        method: "POST",
        headers: { Authorization: "Bearer internal-test-key", "Content-Type": "application/json" },
        body: JSON.stringify({ metrics: ["badMetric"] }),
      }), context);
      strictAssert.equal(response.status, 400, "query route must map validation errors to 400");
      const errorPayload = await response.json();
      strictAssert.equal(errorPayload.code, "unsupported_metric");
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

const migrationPath = "supabase/migrations/202606180001_workspace_metric_catalogs_and_query_results.sql";
const helperPath = "src/lib/cmo/lens-ga4-catalog.ts";
const catalogRoutePath = "src/app/api/internal/lens/apps/[appId]/ga4/catalog/route.ts";
const catalogSyncRoutePath = "src/app/api/internal/lens/apps/[appId]/ga4/catalog/sync/route.ts";
const queryRoutePath = "src/app/api/internal/lens/apps/[appId]/ga4/query/route.ts";
const internalAuthPath = "src/lib/cmo/lens-internal-auth.ts";
const dashboardPath = "src/components/cmo-apps/app-workspace-view.tsx";
const autoSyncPath = "src/app/api/internal/lens/metrics/auto-sync/route.ts";

for (const file of [migrationPath, helperPath, catalogRoutePath, catalogSyncRoutePath, queryRoutePath, internalAuthPath, dashboardPath, autoSyncPath]) {
  assertFileExists(file, `${file} is missing`);
}

assertIncludes(migrationPath, "create table if not exists public.workspace_metric_catalogs", "Migration must create workspace_metric_catalogs");
assertIncludes(migrationPath, "create table if not exists public.workspace_metric_query_results", "Migration must create workspace_metric_query_results");
assertIncludes(migrationPath, "workspace_metric_catalogs_unique_property", "Catalog migration must enforce unique property scope");
assertIncludes(migrationPath, "workspace_metric_query_results_unique_query", "Query result migration must enforce unique query hash scope");
assertIncludes(migrationPath, "alter table public.workspace_metric_catalogs enable row level security", "Catalog table must enable RLS");
assertIncludes(migrationPath, "alter table public.workspace_metric_query_results enable row level security", "Query result table must enable RLS");
assertExcludes(migrationPath, /\b(access_token|refresh_token|encrypted_refresh_token|id_token|raw_ga4_response|raw_google_response)\b/i, "M9B tables must not define token or raw GA4 response fields");

for (const file of [catalogRoutePath, catalogSyncRoutePath, queryRoutePath]) {
  assertIncludes(file, "authorizeLensInternalRequest", `${file} must require internal bearer auth`);
  assertExcludes(file, /requireRequestUserIfAuthRequired|cookies\(|next\/headers/i, `${file} must not use frontend auth or cookies`);
}

assertIncludes(internalAuthPath, "CMO_LENS_INTERNAL_API_KEY", "Internal auth helper must require CMO_LENS_INTERNAL_API_KEY");
assertIncludes(catalogRoutePath, 'RouteContext<"/api/internal/lens/apps/[appId]/ga4/catalog">', "Catalog route must use expected path");
assertIncludes(catalogSyncRoutePath, 'RouteContext<"/api/internal/lens/apps/[appId]/ga4/catalog/sync">', "Catalog sync route must use expected path");
assertIncludes(queryRoutePath, 'RouteContext<"/api/internal/lens/apps/[appId]/ga4/query">', "Query route must use expected path");
assertIncludes(catalogRoutePath, "getProductLensGa4Catalog", "Catalog GET route must use catalog helper");
assertIncludes(catalogSyncRoutePath, "syncProductLensGa4Catalog", "Catalog sync route must use sync helper");
assertIncludes(queryRoutePath, "runProductLensGa4AdHocQuery", "Query route must use ad-hoc query helper");
assertIncludes(queryRoutePath, "ProductLensGa4ValidationError", "Query route must map validation errors");

assertIncludes(helperPath, 'schema_version: "product.lens_ga4_catalog.v1"', "Catalog helper must emit product.lens_ga4_catalog.v1");
assertIncludes(helperPath, 'schema_version: "product.lens_ga4_query_result.v1"', "Query helper must emit product.lens_ga4_query_result.v1");
assertIncludes(helperPath, "getWorkspaceGa4MetricSourceMapping", "Helper must read Product GA4 source mapping");
assertIncludes(helperPath, "requireWorkspaceRegistryEntry(appId)", "Helper must resolve appId through workspace registry");
assertIncludes(helperPath, "getLensGoogleAccessToken", "Helper must use existing server-side Google OAuth token flow");
assertIncludes(helperPath, "/metadata", "Catalog helper must call GA4 Metadata API");
assertIncludes(helperPath, ":runReport", "Query helper must call GA4 Data API runReport");
assertIncludes(helperPath, '.from("workspace_metric_catalogs")', "Helper must read/write workspace_metric_catalogs");
assertIncludes(helperPath, '.from("workspace_metric_query_results")', "Helper must read/write workspace_metric_query_results");
assertIncludes(helperPath, "LENS_GA4_AD_HOC_ALLOWED_METRICS", "Helper must define safe metric allowlist");
assertIncludes(helperPath, "LENS_GA4_AD_HOC_ALLOWED_DIMENSIONS", "Helper must define safe dimension allowlist");
assertIncludes(helperPath, "validateAgainstCatalog", "Query helper must validate against metadata catalog");
assertIncludes(helperPath, "ensureCatalog", "Query helper must refresh missing/stale catalog");
assertIncludes(helperPath, "createHash", "Query helper must build query_hash");
assertIncludes(helperPath, "getCachedQueryResult", "Query helper must check cache before GA4 when refresh=false");
assertIncludes(helperPath, "upsertQueryResult", "Query helper must cache normalized query results");
assertMatches(helperPath, /metrics\.length < 1 \|\| metrics\.length > 5/, "Query helper must enforce metric count");
assertMatches(helperPath, /dimensions\.length > 2/, "Query helper must enforce max dimensions");
assertMatches(helperPath, /limit < 1 \|\| limit > 100/, "Query helper must enforce max limit 100");
assertMatches(helperPath, /cacheTtlMinutes < 1 \|\| cacheTtlMinutes > 1440/, "Query helper must enforce max cache TTL 1440");
assertMatches(helperPath, /daysInclusive\(range\.date_start, range\.date_end\) > 90/, "Query helper must enforce max date range");
for (const metric of ["activeUsers", "newUsers", "sessions", "engagementRate", "screenPageViews", "keyEvents", "bounceRate"]) {
  assertIncludes(helperPath, `"${metric}"`, `Allowed metric ${metric} missing`);
}
for (const dimension of ["date", "country", "deviceCategory", "sessionDefaultChannelGroup", "sessionSourceMedium", "eventName", "unifiedPagePathScreen"]) {
  assertIncludes(helperPath, `"${dimension}"`, `Allowed dimension ${dimension} missing`);
}
assertIncludes(helperPath, "raw_ga4_response_included: false", "Helper must not return raw GA4 response");
assertIncludes(helperPath, "no_tokens_returned: true", "Helper must assert no tokens returned");
assertIncludes(helperPath, "vault_write_performed: false", "Helper must assert no Vault writes");
assertIncludes(helperPath, "gbrain_used: false", "Helper must assert no GBrain use");
assertIncludes(helperPath, "hermes_called: false", "Helper must assert no Hermes calls");
assertExcludes(helperPath, /\b(access_token|refresh_token|encrypted_refresh_token|id_token)\s*:/i, "Helper must not expose token fields");
assertExcludes(helperPath, /\/agents\/|runHermes|callHermes|hermes-cmo-runtime|importGBrain|syncGBrain|embedGBrain|dreamGBrain|extractGBrain|queryGBrain|callGBrain/i, "Helper must not call Hermes or GBrain");
assertExcludes(helperPath, /answer\s*=/i, "Product helper must not synthesize final CMO answers");

assertIncludes(dashboardPath, "Source: Lens GA4", "Dashboard must keep safe Lens GA4 source label");
assertIncludes(dashboardPath, "ga4DashboardRangeKey(dateRange)", "Dashboard must keep latest snapshot range mapping");
assertMatches(dashboardPath, /label:\s*"New Users"[\s\S]{0,220}compactMetricValue\(newUsers\)/, "Dashboard must keep safe New Users mapping");
assertMatches(dashboardPath, /Requires activation\/retention definition\./, "Activation/retention must remain definition_needed");
assertMatches(dashboardPath, /Metric definition needed/, "Definition-needed badge must remain");
assertExcludes(dashboardPath, /Activated Users[\s\S]{0,800}activeUsers|activeUsers[\s\S]{0,800}Activated Users/, "activeUsers must not become Activated Users");
assertExcludes(dashboardPath, /D1 Retention[\s\S]{0,800}ga4MetricSnapshot|D7 Retention[\s\S]{0,800}ga4MetricSnapshot/, "Retention must not be populated from GA4 snapshots");

assertIncludes(autoSyncPath, "runProductLensAutoSync", "M9A-1 auto-sync route must remain intact");
assertIncludes(autoSyncPath, "authorizeLensInternalRequest", "M9A-1 auto-sync auth must remain intact");

await assertInternalRouteAuth();

execFileSync(process.execPath, [repoPath("scripts", "cmo-lens-auto-sync-check.mjs")], {
  cwd: root,
  stdio: "pipe",
  env: process.env,
});

console.log("CMO Lens GA4 ad-hoc query check passed.");
