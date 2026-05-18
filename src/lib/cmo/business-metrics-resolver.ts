import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import { readBusinessMetricsSnapshot } from "@/lib/cmo/business-metrics";
import type {
  CmoBusinessMetric,
  CmoBusinessMetricGroup,
  CmoBusinessMetricsResolverGroup,
  CmoBusinessMetricsResolverResult,
  CmoBusinessMetricsResolverStatus,
  CmoBusinessMetricsSnapshot,
} from "@/lib/cmo/app-workspace-types";

const SUPPORTED_APP_ID = "holdstation-mini-app";
const SUPPORTED_SOURCE = "defillama";
const GROUPS: CmoBusinessMetricGroup[] = ["dex_aggregator_volume", "fees_usd"];
const CAVEATS = [
  "DefiLlama values are latest rolling-window snapshots, not fixed calendar-period accounting close data.",
  "JSON business metrics files are source of truth.",
  "n8n is the DefiLlama exporter; CMO does not call DefiLlama directly.",
  "Vault Markdown snapshots are human-readable review/provenance only.",
];

export interface ResolveBusinessMetricsOptions {
  appId: string;
  source?: string | null;
}

function metricHasValue(metric: CmoBusinessMetric): boolean {
  return typeof metric.value === "number" && Number.isFinite(metric.value);
}

function groupStatus(snapshot: CmoBusinessMetricsSnapshot | null): CmoBusinessMetricsResolverStatus {
  if (!snapshot || snapshot.metrics.every((metric) => !metricHasValue(metric))) {
    return "missing";
  }

  return snapshot.status === "connected" ? "connected" : "partial";
}

function resolverStatus(groups: CmoBusinessMetricsResolverGroup[]): CmoBusinessMetricsResolverStatus {
  if (!groups.length || groups.every((group) => group.status === "missing")) {
    return "missing";
  }

  return groups.every((group) => group.status === "connected") ? "connected" : "partial";
}

function displayValue(metric: CmoBusinessMetric | undefined): string {
  if (!metric || !metricHasValue(metric)) {
    return "No data";
  }

  return metric.displayValue && metric.displayValue !== "No data" ? metric.displayValue : String(metric.value);
}

function metricById(metrics: CmoBusinessMetric[]): Map<string, CmoBusinessMetric> {
  const lookup = new Map<string, CmoBusinessMetric>();

  metrics.forEach((metric) => lookup.set(metric.id, metric));

  return lookup;
}

function latestTimestamp(snapshots: Array<CmoBusinessMetricsSnapshot | null>): string | null {
  return snapshots
    .flatMap((snapshot) => [snapshot?.lastUpdatedAt, snapshot?.source.fetchedAt])
    .filter((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function buildSummaryText(groups: CmoBusinessMetricsResolverGroup[], lastUpdatedAt: string | null): string {
  const dex = metricById(groups.find((group) => group.metricGroup === "dex_aggregator_volume")?.metrics ?? []);
  const fees = metricById(groups.find((group) => group.metricGroup === "fees_usd")?.metrics ?? []);

  return [
    "Business Metrics — DefiLlama",
    "Source: cmo.business-metrics.v1 JSON files. n8n exports normalized DefiLlama payloads; CMO does not call DefiLlama directly.",
    `Last updated/fetched: ${lastUpdatedAt ?? "No connected timestamp"}.`,
    "",
    "DEX Aggregator Volume:",
    `- 24h: ${displayValue(dex.get("dex_aggregator_volume_24h"))}`,
    `- 7d: ${displayValue(dex.get("dex_aggregator_volume_7d"))}`,
    `- 30d: ${displayValue(dex.get("dex_aggregator_volume_30d"))}`,
    `- Cumulative: ${displayValue(dex.get("dex_aggregator_volume_cumulative"))}`,
    "",
    "Fees / Revenue:",
    `- 24h: ${displayValue(fees.get("fees_24h"))}`,
    `- 7d: ${displayValue(fees.get("fees_7d"))}`,
    `- 30d: ${displayValue(fees.get("fees_30d"))}`,
    `- Annualized: ${displayValue(fees.get("fees_annualized"))}`,
    `- Cumulative: ${displayValue(fees.get("fees_cumulative"))}`,
    "",
    "Caveats:",
    ...CAVEATS.map((caveat) => `- ${caveat}`),
  ].join("\n");
}

export async function resolveBusinessMetrics(options: ResolveBusinessMetricsOptions): Promise<CmoBusinessMetricsResolverResult | null> {
  if (options.appId !== SUPPORTED_APP_ID || (options.source && options.source !== SUPPORTED_SOURCE)) {
    return null;
  }

  const app = getAppWorkspace(options.appId);

  if (!app) {
    return null;
  }

  const snapshots = await Promise.all(
    GROUPS.map((group) => readBusinessMetricsSnapshot({
      appId: app.id,
      source: SUPPORTED_SOURCE,
      group,
    })),
  );
  const groups = GROUPS.map((metricGroup, index): CmoBusinessMetricsResolverGroup => {
    const snapshot = snapshots[index] ?? null;

    return {
      metricGroup,
      status: groupStatus(snapshot),
      metrics: snapshot?.metrics ?? [],
    };
  });
  const lastUpdatedAt = latestTimestamp(snapshots);

  return {
    schemaVersion: "cmo.business-metrics-resolver.v1",
    workspaceId: app.workspaceId,
    appId: app.id,
    sourceId: app.sourceId,
    source: SUPPORTED_SOURCE,
    status: resolverStatus(groups),
    lastUpdatedAt,
    groups,
    summaryText: buildSummaryText(groups, lastUpdatedAt),
    caveats: CAVEATS,
  };
}
