import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
const appId = "holdstation-mini-app";
const businessMetricsDir = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics", appId, "dune");
const aggregatorPath = path.join(businessMetricsDir, "wld_aggregator_daily.json");
const partnerPath = path.join(businessMetricsDir, "wld_partner_stats_daily.json");
const resolverUrl = `${baseUrl}/api/cmo/apps/${appId}/business-metrics/resolver?source=dune`;

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
    status: "connected",
    lastUpdatedAt: timestamp,
    metrics,
    ...structured,
    diagnostics: {
      availableMetrics: metrics.filter((metric) => metric.value !== null || metric.textValue).map((metric) => metric.id),
      missingMetrics: metrics.filter((metric) => metric.value === null && !metric.textValue).map((metric) => metric.id),
      notes: ["Dune resolver check fixture; restored after test when no local handoff file exists."],
    },
    provenance: {
      sourceWorkflow: "cmo-business-metrics-resolver-check",
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

function groupByName(result, group) {
  return result.groups.find((item) => item.metricGroup === group);
}

function metricValue(group, id) {
  return group.metrics.find((metric) => metric.id === id)?.value;
}

const originalAggregator = await readOptional(aggregatorPath);
const originalPartner = await readOptional(partnerPath);
const usedFixture = originalAggregator === null || originalPartner === null;

try {
  if (usedFixture) {
    await ensureFixtureFiles();
  }

  const result = await getJson(resolverUrl);

  assert(result.response.ok, "Expected Dune resolver endpoint to succeed", {
    status: result.response.status,
    body: result.data ?? result.text,
  });

  const resolver = result.data?.data;

  assert(resolver?.schemaVersion === "cmo.business-metrics-resolver.v1", "Expected resolver schema", resolver);
  assert(resolver.workspaceId === "holdstation", "Expected holdstation workspace", resolver);
  assert(resolver.appId === appId, "Expected Holdstation Mini App scope", resolver);
  assert(resolver.source === "dune", "Expected Dune source", resolver);
  assert(["connected", "partial", "missing"].includes(resolver.status), "Expected resolver status", resolver);
  assert(Array.isArray(resolver.groups) && resolver.groups.length === 2, "Expected two Dune metric groups", resolver.groups);
  assert(typeof resolver.summaryText === "string" && resolver.summaryText.includes("Dune / Worldchain"), "Expected Dune summary text", resolver.summaryText);
  assert(resolver.summaryText.includes("WLD Aggregator Daily"), "Expected WLD Aggregator summary text", resolver.summaryText);
  assert(resolver.summaryText.includes("Partner Stats"), "Expected Partner Stats summary text", resolver.summaryText);
  assert(resolver.summaryText.includes("DefiLlama is deprecated"), "Expected DefiLlama deprecation caveat", resolver.summaryText);
  assert(resolver.summaryText.includes("authoritative source of truth"), "Expected JSON source-of-truth caveat", resolver.summaryText);

  const aggregator = groupByName(resolver, "wld_aggregator_daily");
  const partners = groupByName(resolver, "wld_partner_stats_daily");

  assert(aggregator, "Expected WLD Aggregator group", resolver.groups);
  assert(partners, "Expected Partner Stats group", resolver.groups);
  assert(metricValue(aggregator, "wld_aggregator_latest_daily_volume_usd") === 2020 || !usedFixture, "Expected latest daily volume fixture value", aggregator.metrics);
  assert(metricValue(partners, "wld_partner_total_transactions") === 2400 || !usedFixture, "Expected partner transaction fixture value", partners.metrics);
  assert(!resolver.summaryText.toLowerCase().includes("fake"), "Expected no fake values in summary", resolver.summaryText);

  const defaultResult = await getJson(`${baseUrl}/api/cmo/apps/${appId}/business-metrics/resolver`);
  assert(defaultResult.response.ok, "Expected default resolver endpoint to succeed", {
    status: defaultResult.response.status,
    body: defaultResult.data ?? defaultResult.text,
  });
  assert(defaultResult.data?.data?.source === "dune", "Expected default resolver source to be authoritative Dune", defaultResult.data);

  const invalidSource = await getJson(`${baseUrl}/api/cmo/apps/${appId}/business-metrics/resolver?source=ga4`);

  assert(invalidSource.response.status === 404, "Expected invalid source to be rejected", {
    status: invalidSource.response.status,
    body: invalidSource.data ?? invalidSource.text,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        usedFixture,
        source: resolver.source,
        status: resolver.status,
        groups: resolver.groups.map((group) => `${group.metricGroup}:${group.status}`),
      },
      null,
      2,
    ),
  );
} finally {
  if (usedFixture) {
    await restoreFile(aggregatorPath, originalAggregator);
    await restoreFile(partnerPath, originalPartner);
  }
}
