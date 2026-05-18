import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const appId = "holdstation-mini-app";
const businessMetricsDir = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics", appId, "defillama");
const dexPath = path.join(businessMetricsDir, "dex_aggregator_volume.json");
const feesPath = path.join(businessMetricsDir, "fees_usd.json");
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
  "DefiLlama",
  `${today} - DefiLlama Snapshot.md`,
);
const requiredMetrics = {
  dex_aggregator_volume: [
    "dex_aggregator_volume_24h",
    "dex_aggregator_volume_7d",
    "dex_aggregator_volume_30d",
    "dex_aggregator_volume_cumulative",
  ],
  fees_usd: ["fees_annualized", "fees_24h", "fees_7d", "fees_30d", "fees_cumulative"],
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
    status: metrics.some((metric) => metric.value === null) ? "partial" : "connected",
    lastUpdatedAt: timestamp,
    metrics,
    diagnostics: {
      availableMetrics: metrics.filter((metric) => metric.value !== null).map((metric) => metric.id),
      missingMetrics: metrics.filter((metric) => metric.value === null).map((metric) => metric.id),
      notes: ["Dashboard check fixture; restored after test when no local handoff file exists."],
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
        { id: "fees_annualized", label: "Fees Annualized", value: 6388, displayValue: "$6,388", unit: "usd", status: "connected" },
        { id: "fees_24h", label: "Fees 24h", value: 12, displayValue: "$12", unit: "usd", status: "connected" },
        { id: "fees_7d", label: "Fees 7d", value: 104, displayValue: "$104", unit: "usd", status: "connected" },
        { id: "fees_30d", label: "Fees 30d", value: 525, displayValue: "$525", unit: "usd", status: "connected" },
        { id: "fees_cumulative", label: "Fees Cumulative", value: null, displayValue: "No data", unit: "usd", status: "missing" },
      ]),
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
  assert(snapshot.source?.type === "defillama", `${group}: expected DefiLlama source`, snapshot);
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

    if (metric.value === null) {
      assert(metric.displayValue === "No data", `${group}: null metric must display No data`, metric);
      assert(metric.status !== "connected", `${group}: null metric cannot be connected`, metric);
    }
  }
}

const originalDex = await readOptional(dexPath);
const originalFees = await readOptional(feesPath);
const originalSnapshot = await readOptional(snapshotPath);
const usedFixture = originalDex === null || originalFees === null;

try {
  if (usedFixture) {
    await ensureFixtureFiles();
  }

  const dex = JSON.parse(await readFile(dexPath, "utf8"));
  const fees = JSON.parse(await readFile(feesPath, "utf8"));

  validateSnapshot(dex, "dex_aggregator_volume");
  validateSnapshot(fees, "fees_usd");

  await execFileAsync(process.execPath, ["scripts/cmo-business-metrics-vault-snapshot.mjs"], {
    cwd: process.cwd(),
    maxBuffer: 5 * 1024 * 1024,
  });

  const markdown = await readFile(snapshotPath, "utf8");

  assert(markdown.includes("# "), "Expected snapshot title", markdown.slice(0, 300));
  assert(markdown.includes("## DEX Aggregator Volume"), "Expected DEX section in snapshot", markdown);
  assert(markdown.includes("## Fees / Revenue"), "Expected Fees section in snapshot", markdown);
  assert(markdown.includes("JSON files are the source of truth"), "Expected JSON source of truth note", markdown);
  assert(markdown.includes("DefiLlama values are latest rolling-window snapshots"), "Expected rolling-window caveat", markdown);

  console.log(
    JSON.stringify(
      {
        ok: true,
        usedFixture,
        snapshotPath,
        dexMetrics: dex.metrics.length,
        feesMetrics: fees.metrics.length,
      },
      null,
      2,
    ),
  );
} finally {
  if (usedFixture) {
    await restoreFile(dexPath, originalDex);
    await restoreFile(feesPath, originalFees);
    await restoreFile(snapshotPath, originalSnapshot);
  }
}
