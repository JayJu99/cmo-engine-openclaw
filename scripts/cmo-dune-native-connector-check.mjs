import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const files = {
  helper: "src/lib/cmo/dune-business-metrics.ts",
  config: "src/lib/cmo/config.ts",
  businessMetrics: "src/lib/cmo/business-metrics.ts",
  dashboard: "src/components/cmo-apps/app-workspace-view.tsx",
  syncRoute: "src/app/api/internal/lens/apps/[appId]/business/dune/sync/route.ts",
  snapshotsRoute: "src/app/api/internal/lens/apps/[appId]/business/dune/snapshots/route.ts",
  reportPacksRoute: "src/app/api/internal/lens/apps/[appId]/business/dune/report-packs/route.ts",
  migration: "supabase/migrations/202606190001_workspace_business_metric_snapshots.sql",
  envExample: ".env.example",
  systemdService: "ops/systemd/cmo-dune-business-sync.service",
  systemdTimer: "ops/systemd/cmo-dune-business-sync.timer",
};

const contents = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])),
);

const checks = [];

function check(name, passed, detail = "") {
  checks.push({ name, passed, detail });
}

function includesAll(text, values) {
  return values.every((value) => text.includes(value));
}

const helper = contents.helper;
const routeFiles = `${contents.syncRoute}\n${contents.snapshotsRoute}\n${contents.reportPacksRoute}`;
const allSource = Object.values(contents).join("\n");

check(
  "query registry keeps audited Dune query IDs and source fields",
  includesAll(helper, [
    "5057875",
    "5454333",
    "holdstation_wld_aggregator_tx",
    "Partner Stats on WLD",
    "evt_block_date",
    "cumulative_tx_count",
    "partnerCode",
  ]),
);

check(
  "native transform emits existing metric IDs",
  includesAll(helper, [
    "wld_aggregator_latest_daily_tx",
    "wld_aggregator_cumulative_tx",
    "wld_aggregator_latest_daily_volume_usd",
    "wld_aggregator_cumulative_volume_usd",
    "wld_aggregator_latest_fee_usd",
    "wld_partner_total_volume_usd",
    "wld_partner_total_transactions",
    "wld_partner_active_count",
    "wld_partner_top_by_volume",
    "wld_partner_top_by_tx",
    "wld_aggregator_daily_series",
    "wld_partner_daily_series",
    "wld_partner_summary",
  ]),
);

check(
  "API key is read from server env only",
  contents.config.includes("process.env.CMO_DUNE_API_KEY") &&
    helper.includes("getCmoDuneApiKey()") &&
    !/NEXT_PUBLIC_[A-Z0-9_]*DUNE/i.test(allSource),
);

check(
  "no hardcoded Dune API key shape is present",
  !/(?:dune[_-]?api[_-]?key|x-dune-api-key)['"`]?\s*[:=]\s*['"`][A-Za-z0-9_-]{20,}/i.test(allSource),
);

const runSyncIndex = helper.indexOf("export async function runNativeDuneBusinessSync");
const runSyncBody = runSyncIndex >= 0 ? helper.slice(runSyncIndex) : helper;
const dryRunIndex = runSyncBody.indexOf("if (dryRun)");
const fetchIndex = runSyncBody.indexOf("fetchDuneRowsForResultMode");
check(
  "dryRun path is before the Dune fetch path",
  dryRunIndex >= 0 && fetchIndex > dryRunIndex,
  `dryRunIndex=${dryRunIndex} fetchIndex=${fetchIndex}`,
);

check(
  "result modes and Dune execution endpoints are wired",
  includesAll(helper, [
    '"latest_result"',
    '"execute_and_poll"',
    '"execute_if_stale"',
    "/execute",
    "/status",
    "/results?limit=",
    "QUERY_STATE_COMPLETED",
    "DEFAULT_RESULT_STALE_AFTER_DAYS = 2",
  ]) && contents.syncRoute.includes("resultMode"),
);

check(
  "internal routes require Lens bearer auth",
  [contents.syncRoute, contents.snapshotsRoute, contents.reportPacksRoute].every((text) =>
    text.includes("import { authorizeLensInternalRequest }") &&
    text.includes("const authFailure = authorizeLensInternalRequest(request)") &&
    text.includes("return authFailure"),
  ),
);

check(
  "snapshot and report-pack routes expose safety metadata",
  contents.snapshotsRoute.includes("DUNE_BUSINESS_SAFETY") &&
    contents.snapshotsRoute.includes("start_date") &&
    contents.snapshotsRoute.includes("end_date") &&
    contents.reportPacksRoute.includes("DUNE_BUSINESS_SAFETY") &&
    contents.reportPacksRoute.includes("status: snapshot.status"),
);

check(
  "Supabase migration stores normalized JSON only",
  includesAll(contents.migration, [
    "workspace_business_metric_snapshots",
    "metrics_json jsonb",
    "series_json jsonb",
    "tables_json jsonb",
    "diagnostics_json jsonb",
    "provenance_json jsonb",
  ]) && !/^\s*(?:raw[_-]?response|api[_-]?key|token)\b/im.test(contents.migration),
);

check(
  "Supabase migration enables RLS and grants service_role only",
  contents.migration.includes("enable row level security") &&
    contents.migration.includes("revoke all on table public.workspace_business_metric_snapshots from anon") &&
    contents.migration.includes("revoke all on table public.workspace_business_metric_snapshots from authenticated") &&
    contents.migration.includes("grant select, insert, update, delete on table public.workspace_business_metric_snapshots to service_role"),
);

check(
  "dashboard read path is gated and keeps fallback",
  contents.businessMetrics.includes("readNativeDuneBusinessMetricsSnapshot") &&
    contents.businessMetrics.includes("if (nativeSnapshot)") &&
    contents.businessMetrics.includes("isCmoDuneNativeDashboardEnabled") &&
    contents.businessMetrics.includes("nativeFallback") &&
    helper.includes("isCmoDuneNativeDashboardEnabled()") &&
    helper.includes("nativeSnapshotHasDashboardPayload") &&
    contents.dashboard.includes("dune_native"),
);

check(
  "environment defaults keep native connector disabled",
  includesAll(contents.envExample, [
    "CMO_DUNE_API_KEY=",
    "CMO_DUNE_NATIVE_ENABLED=false",
    "CMO_DUNE_NATIVE_DASHBOARD_ENABLED=false",
  ]),
);

check(
  "systemd templates schedule daily 00:05 UTC and execute_if_stale",
  contents.systemdService.includes("refresh_if_stale") &&
    contents.systemdService.includes('"resultMode":"execute_if_stale"') &&
    !contents.systemdService.includes('"resultMode":"execute_and_poll"') &&
    contents.systemdService.includes("dryRun\":false") &&
    contents.systemdTimer.includes("OnCalendar=*-*-* 00:05:00") &&
    contents.systemdTimer.includes("Timezone=UTC") &&
    !/OnCalendar=.*(?:hourly|\*:05|\*\/\d+)/i.test(contents.systemdTimer),
);

const forbiddenCallPattern = /(from\s+["'][^"']*(?:hermes|gbrain|vault)[^"']*["'])|(?:fetch|axios|ky)\([^)]*(?:hermes|gbrain|vault)/i;
check(
  "connector does not call Hermes, Vault, or GBrain",
  !forbiddenCallPattern.test(helper) && !forbiddenCallPattern.test(routeFiles),
);

check(
  "safety contract says no raw response, Vault write, GBrain, or Hermes",
  includesAll(helper, [
    "no_api_key_returned: true",
    "raw_dune_response_included: false",
    "vault_write_performed: false",
    "gbrain_used: false",
    "hermes_called: false",
  ]),
);

function sampleAggregatorRows(dateEnd) {
  return [
    {
      evt_block_date: "2026-05-04",
      count_tx: 10,
      cumulative_tx_count: 100,
      daily_volume: 25.5,
      cumulative_volume: 1000,
      fee_amount: 1.25,
    },
    {
      evt_block_date: dateEnd,
      count_tx: 12,
      cumulative_tx_count: 112,
      daily_volume: 30,
      cumulative_volume: 1030,
      fee_amount: 1.5,
    },
  ];
}

function loadHelperWithMockFetch(fetchImpl) {
  const transpiled = ts.transpileModule(contents.helper, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const capturedRows = [];
  const cjsModule = { exports: {} };
  const sandbox = {
    module: cjsModule,
    exports: cjsModule.exports,
    console,
    process: { env: { CMO_VAULT_TIME_ZONE: "Asia/Saigon" } },
    Date,
    Intl,
    Promise,
    Number,
    Array,
    Object,
    Set,
    Map,
    JSON,
    RegExp,
    fetch: fetchImpl,
    setTimeout: (callback) => {
      callback();
      return 0;
    },
    require: (id) => {
      if (id === "server-only") {
        return {};
      }

      if (id === "@/lib/cmo/config") {
        return {
          getCmoDuneApiKey: () => "mock-dune-key",
          isCmoDuneNativeDashboardEnabled: () => false,
          isCmoDuneNativeEnabled: () => true,
        };
      }

      if (id === "@/lib/supabase/admin") {
        return {
          createSupabaseAdminClient: () => ({
            from: () => ({
              upsert: (row) => {
                capturedRows.push(row);

                return {
                  select: () => ({
                    single: async () => ({ data: row, error: null }),
                  }),
                };
              },
              select: () => ({
                eq() {
                  return this;
                },
                order: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }

      if (id === "@/lib/cmo/workspace-registry") {
        return {
          requireWorkspaceRegistryEntry: () => ({
            tenantId: "holdstation",
            workspaceId: "holdstation-mini-app",
            appId: "holdstation-mini-app",
            sourceId: "holdstation-mini-app",
          }),
        };
      }

      if (id === "@/lib/cmo/app-workspace-types") {
        return {};
      }

      throw new Error(`Unexpected require: ${id}`);
    },
  };

  vm.runInNewContext(transpiled, sandbox, { filename: "dune-business-metrics.ts" });

  return { helper: cjsModule.exports, capturedRows };
}

function mockJsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

async function runMockedSync(fetchImpl, input) {
  const { helper, capturedRows } = loadHelperWithMockFetch(fetchImpl);
  const result = await helper.runNativeDuneBusinessSync({
    appId: "holdstation-mini-app",
    queryKeys: ["wld_aggregator_daily"],
    mode: "refresh_all",
    ...input,
  });

  return { result, capturedRows };
}

function loadHelperWithoutFetch() {
  return loadHelperWithMockFetch(async () => {
    throw new Error("unexpected_fetch");
  });
}

const { helper: adapterHelper } = loadHelperWithoutFetch();
const nativeAggregatorSnapshot = adapterHelper.transformDuneBusinessRows(
  {
    tenantId: "holdstation",
    workspaceId: "holdstation-mini-app",
    appId: "holdstation-mini-app",
    sourceId: "holdstation-mini-app",
  },
  "wld_aggregator_daily",
  sampleAggregatorRows("2026-06-19"),
  "2026-06-19T00:05:00.000Z",
);
const nativeBusinessSnapshot = adapterHelper.nativeDuneSnapshotToBusinessMetrics(nativeAggregatorSnapshot);

check(
  "dashboard data adapter consumes native snapshots with existing card/chart structure",
  nativeBusinessSnapshot.source.sourceId === "dune_native" &&
    nativeBusinessSnapshot.source.queryId === "5057875" &&
    nativeBusinessSnapshot.lastUpdatedAt === "2026-06-19T00:05:00.000Z" &&
    nativeBusinessSnapshot.metrics.some((metric) => metric.id === "wld_aggregator_latest_daily_tx") &&
    nativeBusinessSnapshot.metrics.some((metric) => metric.id === "wld_aggregator_cumulative_volume_usd") &&
    nativeBusinessSnapshot.series?.some((series) => series.id === "wld_aggregator_daily_series" && series.points.length === 2),
);

const returnedSnapshot = await adapterHelper.upsertNativeDuneBusinessSnapshot(nativeAggregatorSnapshot);

check(
  "syncedAt mapping is non-null when DB row has synced_at",
  returnedSnapshot.syncedAt === "2026-06-19T00:05:00.000Z",
);

const callsLatest = [];
await runMockedSync(async (url, init = {}) => {
  callsLatest.push({ url: String(url), method: init.method ?? "GET" });

  return mockJsonResponse({ result: { rows: sampleAggregatorRows("2026-06-18") }, api_key: "do-not-return", raw_response: "do-not-return" });
}, { resultMode: "latest_result" });

check(
  "mocked latest_result does not execute",
  callsLatest.length === 1 &&
    callsLatest[0].method === "GET" &&
    callsLatest[0].url.includes("/query/5057875/results") &&
    !callsLatest.some((call) => call.url.includes("/execute")),
);

const callsExecute = [];
const executeAndPoll = await runMockedSync(async (url, init = {}) => {
  callsExecute.push({ url: String(url), method: init.method ?? "GET" });

  if (String(url).includes("/execute")) {
    return mockJsonResponse({ execution_id: "exec-123", state: "QUERY_STATE_PENDING", raw_response: "do-not-return" });
  }

  if (String(url).includes("/status")) {
    return mockJsonResponse({ execution_id: "exec-123", state: "QUERY_STATE_COMPLETED", execution_cost_credits: 3 });
  }

  return mockJsonResponse({ result: { rows: sampleAggregatorRows("2026-06-19") }, api_key: "do-not-return" });
}, { resultMode: "execute_and_poll" });

check(
  "mocked execute_and_poll calls execute/status/results in order",
  callsExecute.map((call) => `${call.method} ${call.url.replace(/^https:\/\/api\.dune\.com\/api\/v1/, "")}`).join(" > ") ===
    "POST /query/5057875/execute > GET /execution/exec-123/status > GET /execution/exec-123/results?limit=1000" &&
    executeAndPoll.result.results[0].executionState === "QUERY_STATE_COMPLETED" &&
    executeAndPoll.result.results[0].executionCostCredits === 3,
);

const callsStale = [];
await runMockedSync(async (url, init = {}) => {
  callsStale.push({ url: String(url), method: init.method ?? "GET" });

  if (String(url).includes("/query/5057875/results")) {
    return mockJsonResponse({ result: { rows: sampleAggregatorRows("2026-05-05") } });
  }

  if (String(url).includes("/execute")) {
    return mockJsonResponse({ execution_id: "exec-stale", state: "QUERY_STATE_PENDING" });
  }

  if (String(url).includes("/status")) {
    return mockJsonResponse({ execution_id: "exec-stale", state: "QUERY_STATE_COMPLETED" });
  }

  return mockJsonResponse({ result: { rows: sampleAggregatorRows("2026-06-19") } });
}, { resultMode: "execute_if_stale" });

check(
  "mocked execute_if_stale executes when latest max date is stale",
  callsStale.some((call) => call.url.includes("/query/5057875/results")) &&
    callsStale.some((call) => call.url.includes("/execute")) &&
    callsStale.some((call) => call.url.includes("/execution/exec-stale/results")),
);

const callsFresh = [];
const fresh = await runMockedSync(async (url, init = {}) => {
  callsFresh.push({ url: String(url), method: init.method ?? "GET" });

  return mockJsonResponse({ result: { rows: sampleAggregatorRows("2026-06-18") } });
}, { resultMode: "execute_if_stale" });

check(
  "mocked execute_if_stale skips execution when latest max date is fresh",
  callsFresh.length === 1 &&
    callsFresh[0].url.includes("/query/5057875/results") &&
    !callsFresh.some((call) => call.url.includes("/execute")) &&
    fresh.result.results[0].executionState === "SKIPPED_FRESH_LATEST_RESULT",
);

for (const state of ["QUERY_STATE_FAILED", "QUERY_STATE_CANCELED", "QUERY_STATE_EXPIRED"]) {
  const failed = await runMockedSync(async (url) => {
    if (String(url).includes("/execute")) {
      return mockJsonResponse({ execution_id: `exec-${state}`, state: "QUERY_STATE_PENDING" });
    }

    return mockJsonResponse({
      execution_id: `exec-${state}`,
      state,
      error: { type: "query_error", message: "safe mocked failure" },
    });
  }, { resultMode: "execute_and_poll" });

  check(
    `mocked ${state} returns a clear safe error`,
    failed.result.status === "failed" &&
      failed.result.results[0].status === "failed" &&
      failed.result.results[0].executionState === state &&
      failed.result.results[0].errorCode === `dune_execution_${state.toLowerCase()}` &&
      failed.result.results[0].errorMessage === "safe mocked failure",
  );
}

const slimOutput = JSON.stringify(executeAndPoll.result);
check(
  "sync response is slim and does not include full series points or raw/API key output",
    !slimOutput.includes('"snapshot"') &&
    !slimOutput.includes('"series"') &&
    !slimOutput.includes('"points"') &&
    !slimOutput.includes('"executionId"') &&
    !slimOutput.includes("do-not-return") &&
    !slimOutput.includes("mock-dune-key"),
);

const failed = checks.filter((item) => !item.passed);

console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}
