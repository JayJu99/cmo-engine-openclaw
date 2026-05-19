import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import { readBusinessMetricsSnapshot } from "@/lib/cmo/business-metrics";
import type {
  CmoBusinessMetric,
  CmoBusinessMetricGroup,
  CmoBusinessMetricSourceType,
  CmoBusinessMetricsResolverGroup,
  CmoBusinessMetricsResolverResult,
  CmoBusinessMetricsResolverStatus,
  CmoBusinessMetricsSnapshot,
} from "@/lib/cmo/app-workspace-types";

const SUPPORTED_APP_ID = "holdstation-mini-app";
const AUTHORITATIVE_SOURCE: CmoBusinessMetricSourceType = "dune";
const AUTHORITATIVE_GROUPS: CmoBusinessMetricGroup[] = ["wld_aggregator_daily", "wld_partner_stats_daily"];
const DEPRECATED_DEFILLAMA_GROUPS: CmoBusinessMetricGroup[] = ["dex_aggregator_volume", "fees_usd"];
const CAVEATS = [
  "Dune / Worldchain JSON business metrics files are the authoritative source of truth for Holdstation Mini App metrics.",
  "n8n exports normalized Dune data; CMO does not call Dune directly.",
  "DefiLlama is deprecated and non-authoritative for Holdstation Mini App metrics.",
  "Vault Markdown snapshots are human-readable review/provenance only.",
];

export interface ResolveBusinessMetricsOptions {
  appId: string;
  source?: string | null;
}

function metricHasValue(metric: CmoBusinessMetric): boolean {
  return typeof metric.value === "number" && Number.isFinite(metric.value) || Boolean(metric.textValue) || (metric.displayValue !== "No data" && Boolean(metric.displayValue));
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

  return metric.displayValue && metric.displayValue !== "No data" ? metric.displayValue : metric.textValue ?? String(metric.value);
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

function queryNames(snapshots: Array<CmoBusinessMetricsSnapshot | null>): string[] {
  return snapshots
    .map((snapshot) => snapshot?.source.queryName)
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

function buildDuneSummaryText(groups: CmoBusinessMetricsResolverGroup[], lastUpdatedAt: string | null, names: string[]): string {
  const aggregator = metricById(groups.find((group) => group.metricGroup === "wld_aggregator_daily")?.metrics ?? []);
  const partners = metricById(groups.find((group) => group.metricGroup === "wld_partner_stats_daily")?.metrics ?? []);

  return [
    "Business Metrics - Dune / Worldchain",
    "Source: cmo.business-metrics.v1 JSON files. n8n exports normalized Dune payloads; CMO does not call Dune directly.",
    "Authoritative source for Holdstation Mini App metrics: Dune / Worldchain.",
    `Dune queries: ${names.length ? names.join(" / ") : "holdstation_wld_aggregator_tx / Partner Stats on WLD"}.`,
    `Last updated/fetched: ${lastUpdatedAt ?? "No connected timestamp"}.`,
    "",
    "WLD Aggregator Daily:",
    `- Latest daily transactions: ${displayValue(aggregator.get("wld_aggregator_latest_daily_tx"))}`,
    `- Cumulative transactions: ${displayValue(aggregator.get("wld_aggregator_cumulative_tx"))}`,
    `- Latest daily volume: ${displayValue(aggregator.get("wld_aggregator_latest_daily_volume_usd"))}`,
    `- Cumulative volume: ${displayValue(aggregator.get("wld_aggregator_cumulative_volume_usd"))}`,
    `- Latest fee amount: ${displayValue(aggregator.get("wld_aggregator_latest_fee_usd"))}`,
    "",
    "Partner Stats:",
    `- Partner total volume: ${displayValue(partners.get("wld_partner_total_volume_usd"))}`,
    `- Partner total transactions: ${displayValue(partners.get("wld_partner_total_transactions"))}`,
    `- Active partners: ${displayValue(partners.get("wld_partner_active_count"))}`,
    `- Top partner by volume: ${displayValue(partners.get("wld_partner_top_by_volume"))}`,
    `- Top partner by transactions: ${displayValue(partners.get("wld_partner_top_by_tx"))}`,
    "",
    "Caveats:",
    ...CAVEATS.map((caveat) => `- ${caveat}`),
  ].join("\n");
}

function buildDeprecatedDefiLlamaSummaryText(groups: CmoBusinessMetricsResolverGroup[], lastUpdatedAt: string | null): string {
  const dex = metricById(groups.find((group) => group.metricGroup === "dex_aggregator_volume")?.metrics ?? []);
  const fees = metricById(groups.find((group) => group.metricGroup === "fees_usd")?.metrics ?? []);

  return [
    "Deprecated Business Metrics - DefiLlama",
    "Source: cmo.business-metrics.v1 JSON files. DefiLlama is retained only for backward compatibility and is not authoritative for Holdstation Mini App.",
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
    "- DefiLlama is deprecated and non-authoritative for Holdstation Mini App metrics.",
    "- Use Dune / Worldchain metrics for CMO Chat answers and dashboard decisions.",
  ].join("\n");
}

export async function resolveBusinessMetrics(options: ResolveBusinessMetricsOptions): Promise<CmoBusinessMetricsResolverResult | null> {
  if (options.appId !== SUPPORTED_APP_ID) {
    return null;
  }

  const source: CmoBusinessMetricSourceType = options.source === "defillama" ? "defillama" : AUTHORITATIVE_SOURCE;

  if (options.source && options.source !== "dune" && options.source !== "defillama") {
    return null;
  }

  const app = getAppWorkspace(options.appId);

  if (!app) {
    return null;
  }

  const metricGroups = source === "dune" ? AUTHORITATIVE_GROUPS : DEPRECATED_DEFILLAMA_GROUPS;
  const snapshots = await Promise.all(
    metricGroups.map((group) => readBusinessMetricsSnapshot({
      appId: app.id,
      source,
      group,
    })),
  );
  const groups = metricGroups.map((metricGroup, index): CmoBusinessMetricsResolverGroup => {
    const snapshot = snapshots[index] ?? null;

    return {
      metricGroup,
      status: groupStatus(snapshot),
      metrics: snapshot?.metrics ?? [],
    };
  });
  const lastUpdatedAt = latestTimestamp(snapshots);
  const summaryText = source === "dune"
    ? buildDuneSummaryText(groups, lastUpdatedAt, queryNames(snapshots))
    : buildDeprecatedDefiLlamaSummaryText(groups, lastUpdatedAt);

  return {
    schemaVersion: "cmo.business-metrics-resolver.v1",
    workspaceId: app.workspaceId,
    appId: app.id,
    sourceId: app.sourceId,
    source,
    status: resolverStatus(groups),
    lastUpdatedAt,
    groups,
    summaryText,
    caveats: source === "dune" ? CAVEATS : [
      "DefiLlama is deprecated and non-authoritative for Holdstation Mini App metrics.",
      "Use Dune / Worldchain metrics for CMO Chat answers and dashboard decisions.",
    ],
  };
}
