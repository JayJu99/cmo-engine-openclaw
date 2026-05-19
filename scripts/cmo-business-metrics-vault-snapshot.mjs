import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const appId = "holdstation-mini-app";
const source = process.argv.includes("--source=defillama") ? "defillama" : "dune";
const isDune = source === "dune";
const businessMetricsDir = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics", appId, source);
const primaryGroupPath = path.join(businessMetricsDir, isDune ? "wld_aggregator_daily.json" : "dex_aggregator_volume.json");
const secondaryGroupPath = path.join(businessMetricsDir, isDune ? "wld_partner_stats_daily.json" : "fees_usd.json");
const vaultSnapshotDir = path.join(
  process.cwd(),
  "knowledge",
  "holdstation",
  "07 Knowledge",
  "Data",
  "Business Metrics",
  "Holdstation Mini App",
  isDune ? "Dune" : "DefiLlama",
);
const timezone = process.env.CMO_VAULT_TIME_ZONE || "Asia/Saigon";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const outputPath = path.join(vaultSnapshotDir, `${today} - ${isDune ? "Dune" : "DefiLlama"} Snapshot.md`);

const groupLabels = isDune
  ? {
      wld_aggregator_daily: "WLD Aggregator Daily",
      wld_partner_stats_daily: "Partner Stats",
    }
  : {
      dex_aggregator_volume: "Deprecated DEX Aggregator Volume",
      fees_usd: "Deprecated Fees / Revenue",
    };

const metricOrder = isDune
  ? {
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
    }
  : {
      dex_aggregator_volume: [
        "dex_aggregator_volume_24h",
        "dex_aggregator_volume_7d",
        "dex_aggregator_volume_30d",
        "dex_aggregator_volume_cumulative",
      ],
      fees_usd: ["fees_24h", "fees_7d", "fees_30d", "fees_annualized", "fees_cumulative"],
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
  if (!metric) {
    return "No data";
  }

  if (typeof metric.displayValue === "string" && metric.displayValue.trim() && metric.displayValue !== "No data") {
    return metric.displayValue.trim();
  }

  if (typeof metric.textValue === "string" && metric.textValue.trim()) {
    return metric.textValue.trim();
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
  if (!metric || displayMetric(metric) === "No data") {
    return "missing";
  }

  return typeof metric.status === "string" ? metric.status : "connected";
}

function renderMetricsTable(snapshot, group) {
  const lookup = metricById(snapshot);
  const rows = metricOrder[group].map((id) => {
    const metric = lookup.get(id);
    const label = typeof metric?.label === "string" && metric.label.trim() ? metric.label.trim() : id;

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

  const query = snapshot.source?.queryName ? ` (${snapshot.source.queryName})` : "";
  return `- ${groupLabels[snapshot.metricGroup] ?? snapshot.metricGroup}: ${snapshot.source?.label ?? source}${query} fetched at ${snapshot.source?.fetchedAt ?? "unknown"}`;
}

function seriesSummary(snapshot) {
  const series = Array.isArray(snapshot?.series) ? snapshot.series : [];
  const tables = Array.isArray(snapshot?.tables) ? snapshot.tables : [];
  const lines = [
    ...series.map((item) => `- Series ${item.id}: ${Array.isArray(item.points) ? item.points.length : 0} points preserved in JSON.`),
    ...tables.map((item) => `- Table ${item.id}: ${Array.isArray(item.rows) ? item.rows.length : 0} rows preserved in JSON.`),
  ];

  return lines.length ? lines.join("\n") : "- No series/table payload attached.";
}

function buildMarkdown({ primary, secondary, generatedAt }) {
  const latest = latestTimestamp([primary, secondary]);
  const title = isDune ? "Dune Business Metrics Snapshot" : "Deprecated DefiLlama Business Metrics Snapshot";
  const sourceDescription = isDune ? "Dune / Worldchain handoff via n8n" : "Deprecated DefiLlama handoff via n8n";
  const firstGroup = isDune ? "wld_aggregator_daily" : "dex_aggregator_volume";
  const secondGroup = isDune ? "wld_partner_stats_daily" : "fees_usd";

  return `# ${today} - ${title}

Generated at: ${generatedAt}
App: Holdstation Wallet Miniapp
Workspace: holdstation
CMO appId: holdstation-mini-app
Source: ${sourceDescription}
Schema: cmo.business-metrics.v1

## Summary

This snapshot summarizes the latest normalized ${isDune ? "Dune / Worldchain" : "deprecated DefiLlama"} business metrics received by CMO for Holdstation Mini App.

- Latest source timestamp: ${latest ?? "No connected timestamp"}
- ${groupLabels[firstGroup]} status: ${primary?.status ?? "missing"}
- ${groupLabels[secondGroup]} status: ${secondary?.status ?? "missing"}
- JSON files are the source of truth for machine-readable metrics.

## ${groupLabels[firstGroup]}

${renderMetricsTable(primary, firstGroup)}

## ${groupLabels[secondGroup]}

${renderMetricsTable(secondary, secondGroup)}

## Source & Provenance

${sourceLine(primary)}
${sourceLine(secondary)}

### ${groupLabels[firstGroup]} Provenance

${renderObject(primary?.provenance)}

### ${groupLabels[secondGroup]} Provenance

${renderObject(secondary?.provenance)}

## Series / Table Payloads

${seriesSummary(primary)}
${seriesSummary(secondary)}

## Diagnostics / Caveats

${renderDiagnostics(primary, groupLabels[firstGroup])}
${renderDiagnostics(secondary, groupLabels[secondGroup])}
- ${isDune ? "Dune / Worldchain is the authoritative source for Holdstation Mini App metrics." : "DefiLlama is deprecated and non-authoritative for Holdstation Mini App metrics."}
- n8n exports ${isDune ? "Dune" : "DefiLlama"} data; CMO does not call ${isDune ? "Dune" : "DefiLlama"} directly.
- Missing values remain No data and are not inferred.
- Do not write raw high-row-count series into Vault; JSON preserves detailed series/table payloads.

## JSON Source of Truth

- ${path.relative(process.cwd(), primaryGroupPath).replace(/\\/g, "/")}
- ${path.relative(process.cwd(), secondaryGroupPath).replace(/\\/g, "/")}
`;
}

const primary = await readJson(primaryGroupPath);
const secondary = await readJson(secondaryGroupPath);
const generatedAt = new Date().toISOString();
const markdown = buildMarkdown({ primary, secondary, generatedAt });

await mkdir(vaultSnapshotDir, { recursive: true });
await writeFile(outputPath, markdown, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      source,
      path: outputPath,
      primaryStatus: primary?.status ?? "missing",
      secondaryStatus: secondary?.status ?? "missing",
      generatedAt,
    },
    null,
    2,
  ),
);
