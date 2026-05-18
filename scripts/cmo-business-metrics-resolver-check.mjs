import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
const appId = "holdstation-mini-app";
const businessMetricsDir = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics", appId, "defillama");
const dexPath = path.join(businessMetricsDir, "dex_aggregator_volume.json");
const feesPath = path.join(businessMetricsDir, "fees_usd.json");
const resolverUrl = `${baseUrl}/api/cmo/apps/${appId}/business-metrics/resolver?source=defillama`;

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

function fixtureSnapshot(group, metrics) {
  const timestamp = new Date().toISOString();

  return {
    schemaVersion: "cmo.business-metrics.v1",
    workspaceId: "holdstation",
    appId,
    sourceId: "holdstation__holdstation-mini-app",
    source: {
      type: "defillama",
      fetchedAt: timestamp,
      label: "DefiLlama",
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
    diagnostics: {
      availableMetrics: metrics.filter((metric) => metric.value !== null).map((metric) => metric.id),
      missingMetrics: metrics.filter((metric) => metric.value === null).map((metric) => metric.id),
      notes: ["Resolver check fixture; restored after test when no local handoff file exists."],
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
    dexPath,
    `${JSON.stringify(
      fixtureSnapshot("dex_aggregator_volume", [
        { id: "dex_aggregator_volume_24h", label: "DEX Volume 24h", value: 2020, displayValue: "$2,020", unit: "usd", status: "connected" },
        { id: "dex_aggregator_volume_7d", label: "DEX Volume 7d", value: 17436, displayValue: "$17,436", unit: "usd", status: "connected" },
        { id: "dex_aggregator_volume_30d", label: "DEX Volume 30d", value: 99405, displayValue: "$99,405", unit: "usd", status: "connected" },
        { id: "dex_aggregator_volume_cumulative", label: "DEX Volume Cumulative", value: 14180000, displayValue: "$14.18m", unit: "usd", status: "connected" },
      ]),
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    feesPath,
    `${JSON.stringify(
      fixtureSnapshot("fees_usd", [
        { id: "fees_24h", label: "Fees 24h", value: 12, displayValue: "$12", unit: "usd", status: "connected" },
        { id: "fees_7d", label: "Fees 7d", value: 104, displayValue: "$104", unit: "usd", status: "connected" },
        { id: "fees_30d", label: "Fees 30d", value: 525, displayValue: "$525", unit: "usd", status: "connected" },
        { id: "fees_annualized", label: "Fees Annualized", value: 6388, displayValue: "$6,388", unit: "usd", status: "connected" },
        { id: "fees_cumulative", label: "Fees Cumulative", value: 50365, displayValue: "$50,365", unit: "usd", status: "connected" },
      ]),
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

const originalDex = await readOptional(dexPath);
const originalFees = await readOptional(feesPath);
const usedFixture = originalDex === null || originalFees === null;

try {
  if (usedFixture) {
    await ensureFixtureFiles();
  }

  const result = await getJson(resolverUrl);

  assert(result.response.ok, "Expected resolver endpoint to succeed", {
    status: result.response.status,
    body: result.data ?? result.text,
  });

  const resolver = result.data?.data;

  assert(resolver?.schemaVersion === "cmo.business-metrics-resolver.v1", "Expected resolver schema", resolver);
  assert(resolver.workspaceId === "holdstation", "Expected holdstation workspace", resolver);
  assert(resolver.appId === appId, "Expected Holdstation Mini App scope", resolver);
  assert(resolver.source === "defillama", "Expected DefiLlama source", resolver);
  assert(["connected", "partial", "missing"].includes(resolver.status), "Expected resolver status", resolver);
  assert(Array.isArray(resolver.groups) && resolver.groups.length === 2, "Expected two metric groups", resolver.groups);
  assert(typeof resolver.summaryText === "string" && resolver.summaryText.includes("DEX Aggregator Volume"), "Expected DEX summary text", resolver.summaryText);
  assert(resolver.summaryText.includes("Fees / Revenue"), "Expected Fees summary text", resolver.summaryText);
  assert(resolver.summaryText.includes("JSON business metrics files are source of truth"), "Expected JSON source-of-truth caveat", resolver.summaryText);

  const dex = groupByName(resolver, "dex_aggregator_volume");
  const fees = groupByName(resolver, "fees_usd");

  assert(dex, "Expected DEX group", resolver.groups);
  assert(fees, "Expected fees group", resolver.groups);
  assert(metricValue(dex, "dex_aggregator_volume_24h") === 2020 || !usedFixture, "Expected DEX 24h fixture value", dex.metrics);
  assert(metricValue(fees, "fees_24h") === 12 || !usedFixture, "Expected fees 24h fixture value", fees.metrics);
  assert(!resolver.summaryText.includes("fake"), "Expected no fake values in summary", resolver.summaryText);

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
        status: resolver.status,
        groups: resolver.groups.map((group) => `${group.metricGroup}:${group.status}`),
      },
      null,
      2,
    ),
  );
} finally {
  if (usedFixture) {
    await restoreFile(dexPath, originalDex);
    await restoreFile(feesPath, originalFees);
  }
}
