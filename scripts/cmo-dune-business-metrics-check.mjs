import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
const appId = "holdstation-mini-app";
const endpoint = `${baseUrl}/api/cmo/apps/${appId}/metrics/handoff`;
const businessMetricsDir = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics", appId, "dune");
const aggregatorPath = path.join(businessMetricsDir, "wld_aggregator_daily.json");
const partnerPath = path.join(businessMetricsDir, "wld_partner_stats_daily.json");

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    throw new Error(message);
  }
}

function basicAuthHeader() {
  const username = process.env.BASIC_AUTH_USERNAME;
  const password = process.env.BASIC_AUTH_PASSWORD;

  if (!username || !password) {
    return null;
  }

  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function ingestKeyHeader() {
  return process.env.CMO_METRICS_INGEST_API_KEY || "local-dune-check-key";
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

async function postJson(url, payload) {
  const auth = basicAuthHeader();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cmo-metrics-ingest-key": ingestKeyHeader(),
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })()
    : null;

  return { response, data, text };
}

async function getJson(url) {
  const auth = basicAuthHeader();
  const response = await fetch(url, {
    headers: {
      ...(auth ? { Authorization: auth } : {}),
    },
  });
  const text = await response.text();
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })()
    : null;

  return { response, data, text };
}

function basePayload(group, metrics, structured = {}) {
  const timestamp = new Date().toISOString();

  return {
    schemaVersion: "cmo.metrics-handoff.v1",
    workspaceId: "holdstation",
    sourceId: "holdstation__holdstation-mini-app",
    app: {
      appId,
      sourceId: "holdstation__holdstation-mini-app",
    },
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
    metrics,
    ...structured,
    diagnostics: {
      availableMetrics: metrics.filter((metric) => metric.value !== null || metric.textValue).map((metric) => metric.id),
      missingMetrics: metrics.filter((metric) => metric.value === null && !metric.textValue).map((metric) => metric.id),
      notes: ["Dune handoff smoke payload; restored after test."],
    },
    provenance: {
      sourceWorkflow: "cmo-dune-business-metrics-check",
      safeToWriteVaultSnapshot: false,
    },
  };
}

function aggregatorPayload(overrides = {}) {
  return {
    ...basePayload(
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
    ...overrides,
  };
}

function partnerPayload(overrides = {}) {
  return {
    ...basePayload(
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
    ...overrides,
  };
}

function assertDuneSnapshot(snapshot, group) {
  assert(snapshot?.schemaVersion === "cmo.business-metrics.v1", `${group}: expected business metrics schema`, snapshot);
  assert(snapshot.appId === appId, `${group}: expected Holdstation Mini App appId`, snapshot);
  assert(snapshot.sourceId === "holdstation__holdstation-mini-app", `${group}: expected app sourceId`, snapshot);
  assert(snapshot.source?.type === "dune", `${group}: expected Dune source`, snapshot);
  assert(snapshot.source?.sourceId === "dune", `${group}: expected Dune sourceId`, snapshot);
  assert(snapshot.metricGroup === group, `${group}: expected metric group`, snapshot);
  assert(Array.isArray(snapshot.metrics), `${group}: expected metrics`, snapshot);
}

const originalAggregator = await readOptional(aggregatorPath);
const originalPartner = await readOptional(partnerPath);

try {
  const aggregatorResult = await postJson(endpoint, aggregatorPayload());
  assert(aggregatorResult.response.ok, "Expected valid WLD Aggregator Dune handoff to be accepted", {
    status: aggregatorResult.response.status,
    body: aggregatorResult.data ?? aggregatorResult.text,
  });
  assertDuneSnapshot(aggregatorResult.data?.data, "wld_aggregator_daily");

  const partnerResult = await postJson(endpoint, partnerPayload());
  assert(partnerResult.response.ok, "Expected valid Partner Stats Dune handoff to be accepted", {
    status: partnerResult.response.status,
    body: partnerResult.data ?? partnerResult.text,
  });
  assertDuneSnapshot(partnerResult.data?.data, "wld_partner_stats_daily");

  const writtenAggregator = JSON.parse(await readFile(aggregatorPath, "utf8"));
  const writtenPartner = JSON.parse(await readFile(partnerPath, "utf8"));

  assertDuneSnapshot(writtenAggregator, "wld_aggregator_daily");
  assertDuneSnapshot(writtenPartner, "wld_partner_stats_daily");
  assert(writtenAggregator.series?.some((series) => series.id === "wld_aggregator_daily_series" && series.points.length === 1), "Expected aggregator series points to be preserved", writtenAggregator.series);
  assert(writtenPartner.series?.some((series) => series.id === "wld_partner_daily_series" && series.points.length === 2), "Expected partner daily series to be preserved", writtenPartner.series);
  assert(writtenPartner.tables?.some((table) => table.id === "wld_partner_summary" && table.rows.length === 2), "Expected partner summary table to be preserved", writtenPartner.tables);

  const invalidMetricPayload = aggregatorPayload({
    metrics: [
      { id: "wld_aggregator_latest_daily_tx", label: "Latest Daily Transactions", value: 321, displayValue: "321", unit: "count", status: "connected" },
      { id: "unsupported_dune_metric", label: "Unsupported", value: 1, displayValue: "1", status: "connected" },
    ],
  });
  const invalidMetric = await postJson(endpoint, invalidMetricPayload);
  assert(invalidMetric.response.status === 400, "Expected invalid Dune metric id to be rejected", {
    status: invalidMetric.response.status,
    body: invalidMetric.data ?? invalidMetric.text,
  });

  const invalidGroup = await postJson(endpoint, aggregatorPayload({ metricGroup: "fees_usd" }));
  assert(invalidGroup.response.status === 400, "Expected unsupported Dune metricGroup to be rejected", {
    status: invalidGroup.response.status,
    body: invalidGroup.data ?? invalidGroup.text,
  });

  const invalidSource = await postJson(endpoint, aggregatorPayload({ source: { type: "ga4", fetchedAt: new Date().toISOString() } }));
  assert(invalidSource.response.status === 400, "Expected unsupported source to be rejected", {
    status: invalidSource.response.status,
    body: invalidSource.data ?? invalidSource.text,
  });

  const resolver = await getJson(`${baseUrl}/api/cmo/apps/${appId}/business-metrics/resolver`);
  assert(resolver.response.ok, "Expected default resolver to succeed", {
    status: resolver.response.status,
    body: resolver.data ?? resolver.text,
  });
  assert(resolver.data?.data?.source === "dune", "Expected default resolver to treat Dune as authoritative", resolver.data);
  assert(resolver.data?.data?.summaryText?.includes("DefiLlama is deprecated"), "Expected resolver to mark DefiLlama non-authoritative", resolver.data);

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint,
        files: [aggregatorPath, partnerPath],
        resolverSource: resolver.data.data.source,
      },
      null,
      2,
    ),
  );
} finally {
  await restoreFile(aggregatorPath, originalAggregator);
  await restoreFile(partnerPath, originalPartner);
}
