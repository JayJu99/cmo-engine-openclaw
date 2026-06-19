import { readFile } from "node:fs/promises";

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

const dryRunIndex = helper.indexOf("if (dryRun)");
const fetchIndex = helper.indexOf("fetchDuneRows(config)");
check(
  "dryRun path is before the Dune fetch path",
  dryRunIndex >= 0 && fetchIndex > dryRunIndex,
  `dryRunIndex=${dryRunIndex} fetchIndex=${fetchIndex}`,
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
  contents.snapshotsRoute.includes("DUNE_BUSINESS_SAFETY") && contents.reportPacksRoute.includes("DUNE_BUSINESS_SAFETY"),
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
    helper.includes("isCmoDuneNativeDashboardEnabled()") &&
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
  "systemd templates schedule refresh_if_stale daily at 07:05 Asia/Ho_Chi_Minh",
  contents.systemdService.includes("refresh_if_stale") &&
    contents.systemdService.includes("dryRun\":false") &&
    contents.systemdTimer.includes("07:05:00") &&
    contents.systemdTimer.includes("Asia/Ho_Chi_Minh"),
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

const failed = checks.filter((item) => !item.passed);

console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}
