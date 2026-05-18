import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const appId = "holdstation-mini-app";
const source = "defillama";
const businessMetricsDir = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics", appId, source);
const dexPath = path.join(businessMetricsDir, "dex_aggregator_volume.json");
const feesPath = path.join(businessMetricsDir, "fees_usd.json");
const vaultSnapshotDir = path.join(
  process.cwd(),
  "knowledge",
  "holdstation",
  "07 Knowledge",
  "Data",
  "Business Metrics",
  "Holdstation Mini App",
  "DefiLlama",
);
const timezone = process.env.CMO_VAULT_TIME_ZONE || "Asia/Saigon";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const outputPath = path.join(vaultSnapshotDir, `${today} - DefiLlama Snapshot.md`);

const groupLabels = {
  dex_aggregator_volume: "DEX Aggregator Volume",
  fees_usd: "Fees / Revenue",
};

const metricOrder = {
  dex_aggregator_volume: [
    "dex_aggregator_volume_24h",
    "dex_aggregator_volume_7d",
    "dex_aggregator_volume_30d",
    "dex_aggregator_volume_cumulative",
  ],
  fees_usd: ["fees_24h", "fees_7d", "fees_30d", "fees_annualized", "fees_cumulative"],
};

const metricFallbackLabels = {
  dex_aggregator_volume_24h: "24h",
  dex_aggregator_volume_7d: "7d",
  dex_aggregator_volume_30d: "30d",
  dex_aggregator_volume_cumulative: "Cumulative",
  fees_24h: "24h",
  fees_7d: "7d",
  fees_30d: "30d",
  fees_annualized: "Annualized",
  fees_cumulative: "Cumulative",
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function validMetric(metric) {
  return isRecord(metric) && typeof metric.id === "string";
}

function metricById(snapshot) {
  const lookup = new Map();

  if (Array.isArray(snapshot?.metrics)) {
    snapshot.metrics.filter(validMetric).forEach((metric) => lookup.set(metric.id, metric));
  }

  return lookup;
}

function displayMetric(metric) {
  if (!metric || metric.value === null || metric.value === undefined) {
    return "No data";
  }

  if (typeof metric.displayValue === "string" && metric.displayValue.trim()) {
    return metric.displayValue.trim();
  }

  if (typeof metric.value === "number" && Number.isFinite(metric.value)) {
    if (metric.unit === "usd") {
      return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(metric.value)}`;
    }

    if (metric.unit === "percent") {
      return `${Number(metric.value.toFixed(2)).toLocaleString("en-US")}%`;
    }

    return new Intl.NumberFormat("en-US").format(metric.value);
  }

  return "No data";
}

function statusOf(metric) {
  if (!metric || metric.value === null || metric.value === undefined) {
    return "missing";
  }

  return typeof metric.status === "string" ? metric.status : "connected";
}

function renderMetricsTable(snapshot, group) {
  const lookup = metricById(snapshot);
  const rows = metricOrder[group].map((id) => {
    const metric = lookup.get(id);
    const label = typeof metric?.label === "string" && metric.label.trim() ? metric.label.trim() : metricFallbackLabels[id] ?? id;

    return `| ${label} | ${displayMetric(metric)} | ${statusOf(metric)} |`;
  });

  return ["| Metric | Value | Status |", "| --- | ---: | --- |", ...rows].join("\n");
}

function renderDiagnostics(snapshot, label) {
  if (!snapshot) {
    return `- ${label}: JSON file missing.`;
  }

  const notes = Array.isArray(snapshot.diagnostics?.notes) ? snapshot.diagnostics.notes.filter((note) => typeof note === "string") : [];
  const available = Array.isArray(snapshot.diagnostics?.availableMetrics) ? snapshot.diagnostics.availableMetrics.filter((item) => typeof item === "string") : [];
  const missing = Array.isArray(snapshot.diagnostics?.missingMetrics) ? snapshot.diagnostics.missingMetrics.filter((item) => typeof item === "string") : [];

  return [
    `- ${label} status: ${snapshot.status ?? "missing"}`,
    `- ${label} available metrics: ${available.length ? available.join(", ") : "none"}`,
    `- ${label} missing metrics: ${missing.length ? missing.join(", ") : "none"}`,
    ...notes.map((note) => `- ${label} note: ${note}`),
  ].join("\n");
}

function renderObject(value) {
  if (!isRecord(value)) {
    return "- Not supplied.";
  }

  return Object.entries(value)
    .map(([key, entry]) => `- ${key}: ${typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" ? entry : JSON.stringify(entry)}`)
    .join("\n");
}

function latestTimestamp(snapshots) {
  return snapshots
    .flatMap((snapshot) => [snapshot?.lastUpdatedAt, snapshot?.source?.fetchedAt])
    .filter((value) => typeof value === "string" && !Number.isNaN(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function sourceLine(snapshot) {
  if (!snapshot) {
    return "- Missing JSON snapshot.";
  }

  return `- ${groupLabels[snapshot.metricGroup] ?? snapshot.metricGroup}: ${snapshot.source?.label ?? "DefiLlama"} fetched at ${snapshot.source?.fetchedAt ?? "unknown"}`;
}

function buildMarkdown({ dex, fees, generatedAt }) {
  const latest = latestTimestamp([dex, fees]);

  return `# ${today} - DefiLlama Business Metrics Snapshot

Generated at: ${generatedAt}
App: Holdstation Wallet Miniapp
Workspace: holdstation
CMO appId: holdstation-mini-app
Source: DefiLlama handoff via n8n
Schema: cmo.business-metrics.v1

## Summary

This snapshot summarizes the latest normalized DefiLlama business metrics received by CMO for Holdstation Mini App.

- Latest source timestamp: ${latest ?? "No connected timestamp"}
- DEX Aggregator Volume status: ${dex?.status ?? "missing"}
- Fees / Revenue status: ${fees?.status ?? "missing"}
- JSON files are the source of truth for machine-readable metrics.

## DEX Aggregator Volume

${renderMetricsTable(dex, "dex_aggregator_volume")}

## Fees / Revenue

${renderMetricsTable(fees, "fees_usd")}

## Source & Provenance

${sourceLine(dex)}
${sourceLine(fees)}

### DEX Provenance

${renderObject(dex?.provenance)}

### Fees Provenance

${renderObject(fees?.provenance)}

## Diagnostics / Caveats

${renderDiagnostics(dex, "DEX Aggregator Volume")}
${renderDiagnostics(fees, "Fees / Revenue")}
- DefiLlama values are latest rolling-window snapshots, not fixed calendar-period accounting close data.
- CMO does not call DefiLlama directly; n8n remains the exporter.
- Missing values remain No data and are not inferred.

## JSON Source of Truth

- ${path.relative(process.cwd(), dexPath).replace(/\\/g, "/")}
- ${path.relative(process.cwd(), feesPath).replace(/\\/g, "/")}
`;
}

const dex = await readJson(dexPath);
const fees = await readJson(feesPath);
const generatedAt = new Date().toISOString();
const markdown = buildMarkdown({ dex, fees, generatedAt });

await mkdir(vaultSnapshotDir, { recursive: true });
await writeFile(outputPath, markdown, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      path: outputPath,
      dexStatus: dex?.status ?? "missing",
      feesStatus: fees?.status ?? "missing",
      generatedAt,
    },
    null,
    2,
  ),
);
