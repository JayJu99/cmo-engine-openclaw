import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
const handoffEndpoint = `${baseUrl}/api/cmo/apps/holdstation-mini-app/metrics/handoff`;
const businessMetricsDir = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics", "holdstation-mini-app", "defillama");
const dexPath = path.join(businessMetricsDir, "dex_aggregator_volume.json");
const feesPath = path.join(businessMetricsDir, "fees_usd.json");
const ingestKey = process.env.CMO_METRICS_INGEST_API_KEY || "local-metrics-handoff-smoke";

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    process.exit(1);
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

async function post(payload, options = {}) {
  const auth = basicAuthHeader();
  const response = await fetch(options.url || handoffEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cmo-metrics-ingest-key": options.ingestKey ?? ingestKey,
      ...(auth ? { Authorization: auth } : {}),
      ...(options.headers || {}),
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

async function get(url) {
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

function basePayload(metricGroup, metrics) {
  const timestamp = new Date().toISOString();

  return {
    schemaVersion: "cmo.metrics-handoff.v1",
    workspaceId: "holdstation",
    app: {
      appId: "holdstation-mini-app",
      sourceId: "holdstation__holdstation-mini-app",
    },
    source: {
      type: "defillama",
      fetchedAt: timestamp,
      label: "DefiLlama",
    },
    metricDomain: "business",
    metricGroup,
    dateRange: {
      preset: "last_7_days",
      startDate: "2026-05-11",
      endDate: "2026-05-17",
      timezone: "Asia/Ho_Chi_Minh",
    },
    metrics,
    diagnostics: {
      availableMetrics: metrics.filter((metric) => metric.value !== null).map((metric) => metric.id),
      missingMetrics: metrics.filter((metric) => metric.value === null).map((metric) => metric.id),
      notes: ["Imported from metrics handoff smoke."],
    },
    sourceStats: {
      rowCount: metrics.length,
      smoke: true,
    },
    provenance: {
      sourceWorkflow: "cmo-metrics-handoff-smoke",
      safeToWriteVaultSnapshot: false,
    },
  };
}

function metricMap(snapshot) {
  return new Map(snapshot.metrics.map((metric) => [metric.id, metric]));
}

function validateBusinessSnapshot(snapshot, group) {
  assert(snapshot?.schemaVersion === "cmo.business-metrics.v1", `${group}: expected business metrics schema`, snapshot);
  assert(snapshot.workspaceId === "holdstation", `${group}: expected holdstation workspace`, snapshot);
  assert(snapshot.appId === "holdstation-mini-app", `${group}: expected Holdstation Mini App scope`, snapshot);
  assert(snapshot.sourceId === "holdstation__holdstation-mini-app", `${group}: expected app sourceId`, snapshot);
  assert(snapshot.source?.type === "defillama", `${group}: expected DefiLlama source`, snapshot);
  assert(snapshot.metricDomain === "business", `${group}: expected business domain`, snapshot);
  assert(snapshot.metricGroup === group, `${group}: expected metricGroup`, snapshot);
  assert(["connected", "missing", "partial", "placeholder"].includes(snapshot.status), `${group}: invalid status`, snapshot);
  assert(Array.isArray(snapshot.metrics), `${group}: expected metrics array`, snapshot);
  assert(Array.isArray(snapshot.diagnostics?.availableMetrics), `${group}: expected availableMetrics`, snapshot);
  assert(Array.isArray(snapshot.diagnostics?.missingMetrics), `${group}: expected missingMetrics`, snapshot);
  assert(snapshot.provenance?.safeToWriteVaultSnapshot === false, `${group}: expected provenance to be preserved`, snapshot.provenance);
}

const dexPayload = basePayload("dex_aggregator_volume", [
  {
    id: "dex_aggregator_volume_24h",
    label: "DEX Volume 24h",
    value: 12345.67,
    displayValue: "$12,345.67",
    unit: "usd",
    status: "connected",
  },
  {
    id: "dex_aggregator_volume_7d",
    label: "DEX Volume 7d",
    value: 45678.9,
    displayValue: "$45,678.90",
    unit: "usd",
    status: "connected",
  },
]);

const feesPayload = basePayload("fees_usd", [
  {
    id: "fees_annualized",
    label: "Fees Annualized",
    value: 250000,
    displayValue: "$250,000",
    unit: "usd",
    status: "connected",
  },
  {
    id: "fees_24h",
    label: "Fees 24h",
    value: 500,
    displayValue: "$500",
    unit: "usd",
    status: "connected",
  },
  {
    id: "fees_cumulative",
    label: "Fees Cumulative",
    value: null,
    displayValue: "No data",
    unit: "usd",
    status: "missing",
  },
]);

const originalDex = await readOptional(dexPath);
const originalFees = await readOptional(feesPath);

try {
  if (process.env.CMO_METRICS_INGEST_API_KEY) {
    const unauthorized = await post(dexPayload, { ingestKey: "invalid-cmo-metrics-handoff-key" });

    assert(unauthorized.response.status === 401, "Expected invalid ingest key to be rejected", {
      status: unauthorized.response.status,
      body: unauthorized.data ?? unauthorized.text,
    });
  }

  const dexResult = await post(dexPayload);

  assert(dexResult.response.ok, "Expected DEX volume handoff to succeed", {
    status: dexResult.response.status,
    body: dexResult.data ?? dexResult.text,
  });
  validateBusinessSnapshot(dexResult.data?.data, "dex_aggregator_volume");

  const feesResult = await post(feesPayload);

  assert(feesResult.response.ok, "Expected fees handoff to succeed", {
    status: feesResult.response.status,
    body: feesResult.data ?? feesResult.text,
  });
  validateBusinessSnapshot(feesResult.data?.data, "fees_usd");

  const dexFile = JSON.parse(await readFile(dexPath, "utf8"));
  const feesFile = JSON.parse(await readFile(feesPath, "utf8"));

  validateBusinessSnapshot(dexFile, "dex_aggregator_volume");
  validateBusinessSnapshot(feesFile, "fees_usd");

  const dexMetrics = metricMap(dexFile);
  const feesMetrics = metricMap(feesFile);

  assert(dexMetrics.get("dex_aggregator_volume_24h")?.value === 12345.67, "Expected DEX 24h value to be written", dexFile.metrics);
  assert(dexMetrics.get("dex_aggregator_volume_30d")?.value === null, "Expected missing DEX 30d value to remain null", dexFile.metrics);
  assert(dexMetrics.get("dex_aggregator_volume_30d")?.displayValue === "No data", "Expected missing DEX 30d to display No data", dexFile.metrics);
  assert(feesMetrics.get("fees_cumulative")?.value === null, "Expected null fees cumulative to remain null", feesFile.metrics);
  assert(feesMetrics.get("fees_cumulative")?.displayValue === "No data", "Expected null fees cumulative to display No data", feesFile.metrics);
  assert(!dexFile.metrics.some((metric) => metric.id === "fake_metric"), "Expected no fake DEX metrics", dexFile.metrics);
  assert(!feesFile.metrics.some((metric) => metric.id === "fake_metric"), "Expected no fake fees metrics", feesFile.metrics);

  const getDex = await get(`${baseUrl}/api/cmo/apps/holdstation-mini-app/business-metrics?source=defillama&group=dex_aggregator_volume`);

  assert(getDex.response.ok, "Expected business metrics GET endpoint to return DEX snapshot", {
    status: getDex.response.status,
    body: getDex.data ?? getDex.text,
  });
  validateBusinessSnapshot(getDex.data?.data, "dex_aggregator_volume");

  const invalidApp = await post(dexPayload, {
    url: `${baseUrl}/api/cmo/apps/wrong-app/metrics/handoff`,
  });

  assert(invalidApp.response.status === 404, "Expected invalid appId to be rejected", {
    status: invalidApp.response.status,
    body: invalidApp.data ?? invalidApp.text,
  });

  const invalidSource = await post({
    ...dexPayload,
    source: {
      ...dexPayload.source,
      type: "ga4",
    },
  });

  assert(invalidSource.response.status === 400, "Expected invalid source to be rejected", {
    status: invalidSource.response.status,
    body: invalidSource.data ?? invalidSource.text,
  });

  const invalidGroup = await post({
    ...dexPayload,
    metricGroup: "wallet_metrics",
  });

  assert(invalidGroup.response.status === 400, "Expected invalid metricGroup to be rejected", {
    status: invalidGroup.response.status,
    body: invalidGroup.data ?? invalidGroup.text,
  });

  const invalidMetric = await post({
    ...dexPayload,
    metrics: [
      ...dexPayload.metrics,
      {
        id: "fake_metric",
        label: "Fake Metric",
        value: 1,
        displayValue: "1",
        unit: "usd",
        status: "connected",
      },
    ],
  });

  assert(invalidMetric.response.status === 400, "Expected invalid metric id to be rejected", {
    status: invalidMetric.response.status,
    body: invalidMetric.data ?? invalidMetric.text,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dexMetrics: dexFile.metrics.length,
        feesMetrics: feesFile.metrics.length,
        restored: true,
      },
      null,
      2,
    ),
  );
} finally {
  await restoreFile(dexPath, originalDex);
  await restoreFile(feesPath, originalFees);
}
