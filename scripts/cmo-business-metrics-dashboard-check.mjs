import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const appId = "holdstation-mini-app";
const businessMetricsDir = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics", appId, "dune");
const aggregatorPath = path.join(businessMetricsDir, "wld_aggregator_daily.json");
const partnerPath = path.join(businessMetricsDir, "wld_partner_stats_daily.json");
const timezone = process.env.CMO_VAULT_TIME_ZONE || "Asia/Saigon";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const snapshotPath = path.join(
  process.cwd(),
  "knowledge",
  "holdstation",
  "07 Knowledge",
  "Data",
  "Business Metrics",
  "Holdstation Mini App",
  "Dune",
  `${today} - Dune Snapshot.md`,
);
const requiredMetrics = {
  wld_aggregator_daily: [
    "wld_aggregator_latest_daily_tx",
    "wld_aggregator_cumulative_tx",
    "wld_aggregator_latest_daily_volume_usd",
    "wld_aggregator_cumulative_volume_usd",
    "wld_aggregator_latest_fee_usd",
  ],
  wld_partner_stats_daily: [
    "wld_partner_total_volume_usd",
    "wld_partner_total_transactions",
    "wld_partner_active_count",
    "wld_partner_top_by_volume",
    "wld_partner_top_by_tx",
  ],
};

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    process.exit(1);
  }
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function restoreFile(filePath, originalContent) {
  if (originalContent === null) {
    await rm(filePath, { force: true });
    return;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, originalContent, "utf8");
}

function fixtureSnapshot(group, metrics, structured = {}) {
  const timestamp = new Date().toISOString();

  return {
    schemaVersion: "cmo.business-metrics.v1",
    workspaceId: "holdstation",
    appId,
    sourceId: "holdstation__holdstation-mini-app",
    source: {
      type: "dune",
      sourceId: "dune",
      fetchedAt: timestamp,
      label: "Dune",
      queryName: group === "wld_aggregator_daily" ? "holdstation_wld_aggregator_tx" : "Partner Stats on WLD",
    },
    metricDomain: "business",
    metricGroup: group,
    dateRange: {
      preset: "last_7_days",
      startDate: "2026-05-11",
      endDate: "2026-05-17",
      timezone: "Asia/Ho_Chi_Minh",
    },
    status: metrics.some((metric) => metric.value === null && !metric.textValue) ? "partial" : "connected",
    lastUpdatedAt: timestamp,
    metrics,
    ...structured,
    diagnostics: {
      availableMetrics: metrics.filter((metric) => metric.value !== null || metric.textValue).map((metric) => metric.id),
      missingMetrics: metrics.filter((metric) => metric.value === null && !metric.textValue).map((metric) => metric.id),
      notes: ["Dune dashboard check fixture; restored after test when no local handoff file exists."],
    },
    sourceStats: {
      smokeFixture: true,
    },
    provenance: {
      sourceWorkflow: "cmo-business-metrics-dashboard-check",
      safeToWriteVaultSnapshot: false,
    },
  };
}

async function ensureFixtureFiles() {
  await mkdir(businessMetricsDir, { recursive: true });
  await writeFile(
    aggregatorPath,
    `${JSON.stringify(
      fixtureSnapshot(
        "wld_aggregator_daily",
        [
          { id: "wld_aggregator_latest_daily_tx", label: "Latest Daily Transactions", value: 321, displayValue: "321", unit: "count", status: "connected" },
          { id: "wld_aggregator_cumulative_tx", label: "Cumulative Transactions", value: 12000, displayValue: "12,000", unit: "count", status: "connected" },
          { id: "wld_aggregator_latest_daily_volume_usd", label: "Latest Daily Volume", value: 2020, displayValue: "$2,020", unit: "usd", status: "connected" },
          { id: "wld_aggregator_cumulative_volume_usd", label: "Cumulative Volume", value: 14180000, displayValue: "$14.18m", unit: "usd", status: "connected" },
          { id: "wld_aggregator_latest_fee_usd", label: "Latest Fee Amount", value: 12, displayValue: "$12", unit: "usd", status: "connected" },
        ],
        {
          series: [
            {
              id: "wld_aggregator_daily_series",
              points: [
                {
                  evt_block_date: "2026-05-17",
                  count_tx: 321,
                  cumulative_tx_count: 12000,
                  daily_volume: 2020,
                  cumulative_volume: 14180000,
                  fee_amount: 12,
                },
              ],
            },
          ],
        },
      ),
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    partnerPath,
    `${JSON.stringify(
      fixtureSnapshot(
        "wld_partner_stats_daily",
        [
          { id: "wld_partner_total_volume_usd", label: "Partner Total Volume", value: 98000, displayValue: "$98,000", unit: "usd", status: "connected" },
          { id: "wld_partner_total_transactions", label: "Partner Total Transactions", value: 2400, displayValue: "2,400", unit: "count", status: "connected" },
          { id: "wld_partner_active_count", label: "Active Partners", value: 5, displayValue: "5", unit: "count", status: "connected" },
          { id: "wld_partner_top_by_volume", label: "Top Partner by Volume", value: null, textValue: "HOLD", displayValue: "HOLD", status: "connected" },
          { id: "wld_partner_top_by_tx", label: "Top Partner by Transactions", value: null, textValue: "MINI", displayValue: "MINI", status: "connected" },
        ],
        {
          series: [
            {
              id: "wld_partner_daily_series",
              points: [
                { evt_block_date: "2026-05-17", partnerCode: "HOLD", volume: 61000, count_tx: 1300 },
                { evt_block_date: "2026-05-17", partnerCode: "MINI", volume: 37000, count_tx: 1100 },
              ],
            },
          ],
          tables: [
            {
              id: "wld_partner_summary",
              rows: [
                { partnerCode: "HOLD", total_volume: 61000, total_transactions: 1300, volume_share_pct: 62.24, tx_share_pct: 54.17, active_days: 7 },
                { partnerCode: "MINI", total_volume: 37000, total_transactions: 1100, volume_share_pct: 37.76, tx_share_pct: 45.83, active_days: 7 },
              ],
            },
          ],
        },
      ),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function validateSnapshot(snapshot, group) {
  assert(snapshot.schemaVersion === "cmo.business-metrics.v1", `${group}: expected cmo.business-metrics.v1 schema`, snapshot);
  assert(snapshot.workspaceId === "holdstation", `${group}: expected holdstation workspace`, snapshot);
  assert(snapshot.appId === appId, `${group}: expected Holdstation Mini App scope`, snapshot);
  assert(snapshot.sourceId === "holdstation__holdstation-mini-app", `${group}: expected app-scoped sourceId`, snapshot);
  assert(snapshot.source?.type === "dune", `${group}: expected Dune source`, snapshot);
  assert(snapshot.source?.sourceId === "dune", `${group}: expected Dune sourceId`, snapshot);
  assert(snapshot.metricDomain === "business", `${group}: expected business metricDomain`, snapshot);
  assert(snapshot.metricGroup === group, `${group}: expected group`, snapshot);
  assert(["connected", "missing", "partial", "placeholder"].includes(snapshot.status), `${group}: invalid status`, snapshot);
  assert(Array.isArray(snapshot.metrics), `${group}: expected metrics array`, snapshot);

  const ids = new Set(snapshot.metrics.map((metric) => metric.id));

  for (const id of requiredMetrics[group]) {
    assert(ids.has(id), `${group}: missing metric ${id}`, snapshot.metrics);
  }

  for (const metric of snapshot.metrics) {
    assert(requiredMetrics[group].includes(metric.id), `${group}: unknown metric ${metric.id}`, snapshot.metrics);
    assert(metric.value === null || typeof metric.value === "number", `${group}: invalid value for ${metric.id}`, metric);
    assert(typeof metric.displayValue === "string" && metric.displayValue.length > 0, `${group}: missing displayValue for ${metric.id}`, metric);

    if (metric.value === null && !metric.textValue) {
      assert(metric.displayValue === "No data", `${group}: null metric without text must display No data`, metric);
      assert(metric.status !== "connected", `${group}: null metric without text cannot be connected`, metric);
    }
  }

  if (group === "wld_aggregator_daily") {
    assert(snapshot.series?.some((series) => series.id === "wld_aggregator_daily_series" && series.points.length > 0), `${group}: expected aggregator series`, snapshot.series);
  }

  if (group === "wld_partner_stats_daily") {
    assert(snapshot.series?.some((series) => series.id === "wld_partner_daily_series" && series.points.length > 0), `${group}: expected partner daily series`, snapshot.series);
    assert(snapshot.tables?.some((table) => table.id === "wld_partner_summary" && table.rows.length > 0), `${group}: expected partner summary table`, snapshot.tables);
  }
}

const originalAggregator = await readOptional(aggregatorPath);
const originalPartner = await readOptional(partnerPath);
const originalSnapshot = await readOptional(snapshotPath);
const usedFixture = originalAggregator === null || originalPartner === null;

try {
  if (usedFixture) {
    await ensureFixtureFiles();
  }

  const aggregator = JSON.parse(await readFile(aggregatorPath, "utf8"));
  const partners = JSON.parse(await readFile(partnerPath, "utf8"));

  validateSnapshot(aggregator, "wld_aggregator_daily");
  validateSnapshot(partners, "wld_partner_stats_daily");

  await execFileAsync(process.execPath, ["scripts/cmo-business-metrics-vault-snapshot.mjs"], {
    cwd: process.cwd(),
    maxBuffer: 5 * 1024 * 1024,
  });

  const markdown = await readFile(snapshotPath, "utf8");

  assert(markdown.includes("# "), "Expected snapshot title", markdown.slice(0, 300));
  assert(markdown.includes("## WLD Aggregator Daily"), "Expected WLD Aggregator section in snapshot", markdown);
  assert(markdown.includes("## Partner Stats"), "Expected Partner Stats section in snapshot", markdown);
  assert(markdown.includes("Dune / Worldchain"), "Expected Dune / Worldchain source note", markdown);
  assert(markdown.includes("JSON files are the source of truth"), "Expected JSON source of truth note", markdown);
  assert(markdown.includes("CMO does not call Dune directly"), "Expected no direct Dune call caveat", markdown);
  assert(markdown.includes("Do not write raw high-row-count series"), "Expected raw-row caveat", markdown);

  console.log(
    JSON.stringify(
      {
        ok: true,
        usedFixture,
        snapshotPath,
        aggregatorMetrics: aggregator.metrics.length,
        partnerMetrics: partners.metrics.length,
      },
      null,
      2,
    ),
  );
} finally {
  if (usedFixture) {
    await restoreFile(aggregatorPath, originalAggregator);
    await restoreFile(partnerPath, originalPartner);
    await restoreFile(snapshotPath, originalSnapshot);
  }
}
