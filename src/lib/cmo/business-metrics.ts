import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import type {
  CmoBusinessMetric,
  CmoBusinessMetricGroup,
  CmoBusinessMetricSourceType,
  CmoBusinessMetricStatus,
  CmoBusinessMetricsSnapshot,
} from "@/lib/cmo/app-workspace-types";

const BUSINESS_METRICS_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "business-metrics");
const DEFAULT_TIMEZONE = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon";
const SUPPORTED_APP_ID = "holdstation-mini-app";
const SUPPORTED_SOURCE: CmoBusinessMetricSourceType = "defillama";
const SUPPORTED_DOMAIN = "business";

const metricDefinitionsByGroup: Record<
  CmoBusinessMetricGroup,
  Array<Pick<CmoBusinessMetric, "id" | "label" | "unit" | "description">>
> = {
  dex_aggregator_volume: [
    {
      id: "dex_aggregator_volume_24h",
      label: "DEX Volume 24h",
      unit: "usd",
      description: "Holdstation Mini App DEX aggregator volume over the latest 24-hour window supplied by DefiLlama handoff.",
    },
    {
      id: "dex_aggregator_volume_7d",
      label: "DEX Volume 7d",
      unit: "usd",
      description: "Holdstation Mini App DEX aggregator volume over the latest 7-day window supplied by DefiLlama handoff.",
    },
    {
      id: "dex_aggregator_volume_30d",
      label: "DEX Volume 30d",
      unit: "usd",
      description: "Holdstation Mini App DEX aggregator volume over the latest 30-day window supplied by DefiLlama handoff.",
    },
    {
      id: "dex_aggregator_volume_cumulative",
      label: "DEX Volume Cumulative",
      unit: "usd",
      description: "Cumulative Holdstation Mini App DEX aggregator volume supplied by DefiLlama handoff.",
    },
  ],
  fees_usd: [
    {
      id: "fees_annualized",
      label: "Fees Annualized",
      unit: "usd",
      description: "Annualized fees supplied by DefiLlama handoff.",
    },
    {
      id: "fees_24h",
      label: "Fees 24h",
      unit: "usd",
      description: "Fees over the latest 24-hour window supplied by DefiLlama handoff.",
    },
    {
      id: "fees_7d",
      label: "Fees 7d",
      unit: "usd",
      description: "Fees over the latest 7-day window supplied by DefiLlama handoff.",
    },
    {
      id: "fees_30d",
      label: "Fees 30d",
      unit: "usd",
      description: "Fees over the latest 30-day window supplied by DefiLlama handoff.",
    },
    {
      id: "fees_cumulative",
      label: "Fees Cumulative",
      unit: "usd",
      description: "Cumulative fees supplied by DefiLlama handoff.",
    },
  ],
};

export interface ReadBusinessMetricsOptions {
  appId: string;
  source?: string | null;
  group?: string | null;
}

export interface IngestBusinessMetricsHandoffOptions {
  appId: string;
  payload: unknown;
  dryRun?: boolean;
}

export class BusinessMetricsHandoffError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "BusinessMetricsHandoffError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureRecord(value: unknown, message: string, code: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new BusinessMetricsHandoffError(message, 400, code);
  }

  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function businessStatus(value: unknown, fallback: CmoBusinessMetricStatus = "missing"): CmoBusinessMetricStatus {
  return value === "connected" || value === "missing" || value === "partial" || value === "placeholder" ? value : fallback;
}

function businessGroup(value: unknown): CmoBusinessMetricGroup | null {
  return value === "dex_aggregator_volume" || value === "fees_usd" ? value : null;
}

function metricDefinitions(group: CmoBusinessMetricGroup): Array<Pick<CmoBusinessMetric, "id" | "label" | "unit" | "description">> {
  return metricDefinitionsByGroup[group];
}

function metricDefinition(group: CmoBusinessMetricGroup, id: string): Pick<CmoBusinessMetric, "id" | "label" | "unit" | "description"> | undefined {
  return metricDefinitions(group).find((item) => item.id === id);
}

function defaultMetric(definition: Pick<CmoBusinessMetric, "id" | "label" | "unit" | "description">): CmoBusinessMetric {
  return {
    ...definition,
    value: null,
    displayValue: "No data",
    status: "missing",
  };
}

function validDateString(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? undefined : value;
}

function ensureDateRange(value: unknown): CmoBusinessMetricsSnapshot["dateRange"] {
  const record = ensureRecord(value, "dateRange is required.", "metrics_handoff_invalid_date_range");
  const startDate = validDateString(record.startDate);
  const endDate = validDateString(record.endDate);

  if (record.startDate !== undefined && !startDate) {
    throw new BusinessMetricsHandoffError("dateRange.startDate must be YYYY-MM-DD when supplied.", 400, "metrics_handoff_invalid_date_range");
  }

  if (record.endDate !== undefined && !endDate) {
    throw new BusinessMetricsHandoffError("dateRange.endDate must be YYYY-MM-DD when supplied.", 400, "metrics_handoff_invalid_date_range");
  }

  if (startDate && endDate && startDate > endDate) {
    throw new BusinessMetricsHandoffError("dateRange.startDate must be before or equal to dateRange.endDate.", 400, "metrics_handoff_invalid_date_range");
  }

  return {
    preset: typeof record.preset === "string" && record.preset.trim() ? record.preset.trim() : undefined,
    startDate,
    endDate,
    timezone: typeof record.timezone === "string" && record.timezone.trim() ? record.timezone.trim() : DEFAULT_TIMEZONE,
  };
}

function normalizeMetricForRead(group: CmoBusinessMetricGroup, value: unknown): CmoBusinessMetric | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const definition = metricDefinition(group, value.id);

  if (!definition) {
    return null;
  }

  const metricValue = typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
  const status = metricValue === null ? "missing" : businessStatus(value.status, "connected");

  return {
    id: definition.id,
    label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : definition.label,
    value: metricValue,
    displayValue: typeof value.displayValue === "string" && value.displayValue.trim() ? value.displayValue.trim() : metricValue === null ? "No data" : String(metricValue),
    unit: value.unit === "usd" || value.unit === "count" || value.unit === "ratio" || value.unit === "percent" ? value.unit : definition.unit,
    status,
    description: typeof value.description === "string" && value.description.trim() ? value.description.trim() : definition.description,
    caveat: typeof value.caveat === "string" && value.caveat.trim() ? value.caveat.trim() : undefined,
  };
}

function normalizeMetricForHandoff(group: CmoBusinessMetricGroup, input: unknown): CmoBusinessMetric {
  const record = ensureRecord(input, "Each metric must be an object.", "metrics_handoff_invalid_metric");
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const definition = metricDefinition(group, id);

  if (!definition) {
    throw new BusinessMetricsHandoffError(`Unsupported metric id for ${group}: ${id || "missing"}.`, 400, "metrics_handoff_unsupported_metric");
  }

  if (record.value !== null && !(typeof record.value === "number" && Number.isFinite(record.value))) {
    throw new BusinessMetricsHandoffError(`Metric ${id} value must be a finite number or null.`, 400, "metrics_handoff_invalid_metric_value");
  }

  const metricValue = typeof record.value === "number" && Number.isFinite(record.value) ? record.value : null;
  const requestedStatus = businessStatus(record.status, metricValue === null ? "missing" : "connected");
  const status = metricValue === null ? requestedStatus === "placeholder" ? "placeholder" : "missing" : requestedStatus;

  return {
    id,
    label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : definition.label,
    value: metricValue,
    displayValue: typeof record.displayValue === "string" && record.displayValue.trim() ? record.displayValue.trim() : metricValue === null ? "No data" : String(metricValue),
    unit: record.unit === "usd" || record.unit === "count" || record.unit === "ratio" || record.unit === "percent" ? record.unit : definition.unit,
    status,
    description: typeof record.description === "string" && record.description.trim() ? record.description.trim() : definition.description,
    caveat: typeof record.caveat === "string" && record.caveat.trim() ? record.caveat.trim() : undefined,
  };
}

function snapshotStatus(metrics: CmoBusinessMetric[]): CmoBusinessMetricsSnapshot["status"] {
  const numericOrPartialCount = metrics.filter((metric) => metric.value !== null || metric.status === "connected" || metric.status === "partial").length;
  const connectedCount = metrics.filter((metric) => metric.status === "connected" && metric.value !== null).length;

  if (connectedCount === metrics.length) {
    return "connected";
  }

  if (numericOrPartialCount > 0) {
    return "partial";
  }

  return "missing";
}

function availableMetricIds(metrics: CmoBusinessMetric[]): string[] {
  return metrics.filter((metric) => metric.value !== null && metric.status !== "missing" && metric.status !== "placeholder").map((metric) => metric.id);
}

function missingMetricIds(metrics: CmoBusinessMetric[]): string[] {
  return metrics.filter((metric) => metric.value === null || metric.status === "missing" || metric.status === "placeholder").map((metric) => metric.id);
}

function businessMetricsFilePath(appId: string, source: CmoBusinessMetricSourceType, group: CmoBusinessMetricGroup): string {
  return path.join(BUSINESS_METRICS_DIR, appId, source, `${group}.json`);
}

function normalizeSnapshot(value: unknown, fallback: CmoBusinessMetricsSnapshot): CmoBusinessMetricsSnapshot {
  if (!isRecord(value)) {
    return fallback;
  }

  if (
    value.schemaVersion !== "cmo.business-metrics.v1" ||
    value.workspaceId !== fallback.workspaceId ||
    value.appId !== fallback.appId ||
    value.sourceId !== fallback.sourceId ||
    value.metricDomain !== fallback.metricDomain ||
    value.metricGroup !== fallback.metricGroup
  ) {
    return {
      ...fallback,
      diagnostics: {
        ...fallback.diagnostics,
        notes: [...fallback.diagnostics.notes, "Ignored business metrics file because its app scope or metric group did not match."],
      },
    };
  }

  const source = isRecord(value.source) ? value.source : {};
  const parsedMetrics = Array.isArray(value.metrics)
    ? value.metrics.map((metric) => normalizeMetricForRead(fallback.metricGroup, metric)).filter((metric): metric is CmoBusinessMetric => Boolean(metric))
    : [];
  const metrics = metricDefinitions(fallback.metricGroup).map((definition) => parsedMetrics.find((metric) => metric.id === definition.id) ?? defaultMetric(definition));
  const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : {};

  return {
    ...fallback,
    source: {
      type: source.type === SUPPORTED_SOURCE ? source.type : SUPPORTED_SOURCE,
      fetchedAt: typeof source.fetchedAt === "string" && !Number.isNaN(Date.parse(source.fetchedAt)) ? source.fetchedAt : fallback.source.fetchedAt,
      label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : undefined,
    },
    dateRange: isRecord(value.dateRange) ? ensureDateRange(value.dateRange) : fallback.dateRange,
    status: businessStatus(value.status, snapshotStatus(metrics)),
    lastUpdatedAt: typeof value.lastUpdatedAt === "string" && !Number.isNaN(Date.parse(value.lastUpdatedAt)) ? value.lastUpdatedAt : null,
    metrics,
    diagnostics: {
      availableMetrics: stringArray(diagnostics.availableMetrics).length ? stringArray(diagnostics.availableMetrics) : availableMetricIds(metrics),
      missingMetrics: stringArray(diagnostics.missingMetrics).length ? stringArray(diagnostics.missingMetrics) : missingMetricIds(metrics),
      notes: stringArray(diagnostics.notes),
    },
    sourceStats: isRecord(value.sourceStats) ? value.sourceStats : undefined,
    provenance: isRecord(value.provenance) ? value.provenance : undefined,
  };
}

export function normalizeBusinessMetricsHandoffPayload(appId: string, payload: unknown): CmoBusinessMetricsSnapshot {
  if (appId !== SUPPORTED_APP_ID) {
    throw new BusinessMetricsHandoffError(`Unsupported business metrics scope: ${appId}`, 404, "business_metrics_scope_not_supported");
  }

  const app = getAppWorkspace(appId);

  if (!app) {
    throw new BusinessMetricsHandoffError(`Unknown business metrics scope: ${appId}`, 404, "business_metrics_scope_not_found");
  }

  const record = ensureRecord(payload, "Metrics handoff payload must be a JSON object.", "metrics_handoff_invalid_payload");

  if (record.schemaVersion !== "cmo.metrics-handoff.v1") {
    throw new BusinessMetricsHandoffError("schemaVersion must be cmo.metrics-handoff.v1.", 400, "metrics_handoff_invalid_schema");
  }

  const appRecord = ensureRecord(record.app, "app is required.", "metrics_handoff_invalid_app");
  const sourceRecord = ensureRecord(record.source, "source is required.", "metrics_handoff_invalid_source");

  if (record.workspaceId !== app.workspaceId || appRecord.appId !== app.id || appRecord.sourceId !== app.sourceId) {
    throw new BusinessMetricsHandoffError("workspaceId, app.appId, and app.sourceId must match the Holdstation Mini App scope.", 403, "metrics_handoff_scope_mismatch");
  }

  if (sourceRecord.type !== SUPPORTED_SOURCE) {
    throw new BusinessMetricsHandoffError("Only DefiLlama metrics handoff is supported in Phase 2.8A.", 400, "metrics_handoff_unsupported_source");
  }

  if (typeof sourceRecord.fetchedAt !== "string" || Number.isNaN(Date.parse(sourceRecord.fetchedAt))) {
    throw new BusinessMetricsHandoffError("source.fetchedAt must be an ISO timestamp.", 400, "metrics_handoff_invalid_source_fetched_at");
  }

  if (record.metricDomain !== SUPPORTED_DOMAIN) {
    throw new BusinessMetricsHandoffError("Only business metricDomain is supported in Phase 2.8A.", 400, "metrics_handoff_unsupported_domain");
  }

  const group = businessGroup(record.metricGroup);

  if (!group) {
    throw new BusinessMetricsHandoffError("Unsupported metricGroup.", 400, "metrics_handoff_unsupported_group");
  }

  if (!Array.isArray(record.metrics)) {
    throw new BusinessMetricsHandoffError("metrics must be an array.", 400, "metrics_handoff_invalid_metrics");
  }

  const suppliedMetrics = record.metrics.map((metric) => normalizeMetricForHandoff(group, metric));
  const suppliedIds = new Set<string>();

  suppliedMetrics.forEach((metric) => {
    if (suppliedIds.has(metric.id)) {
      throw new BusinessMetricsHandoffError(`Duplicate metric id: ${metric.id}.`, 400, "metrics_handoff_duplicate_metric");
    }

    suppliedIds.add(metric.id);
  });

  const metrics = metricDefinitions(group).map((definition) => suppliedMetrics.find((metric) => metric.id === definition.id) ?? defaultMetric(definition));
  const diagnosticsRecord = ensureRecord(record.diagnostics, "diagnostics is required.", "metrics_handoff_invalid_diagnostics");
  const provenanceRecord = ensureRecord(record.provenance, "provenance is required.", "metrics_handoff_invalid_provenance");

  return {
    schemaVersion: "cmo.business-metrics.v1",
    workspaceId: app.workspaceId,
    appId: app.id,
    sourceId: app.sourceId,
    source: {
      type: SUPPORTED_SOURCE,
      fetchedAt: sourceRecord.fetchedAt,
      label: typeof sourceRecord.label === "string" && sourceRecord.label.trim() ? sourceRecord.label.trim() : "DefiLlama",
    },
    metricDomain: SUPPORTED_DOMAIN,
    metricGroup: group,
    dateRange: ensureDateRange(record.dateRange),
    status: snapshotStatus(metrics),
    lastUpdatedAt: new Date().toISOString(),
    metrics,
    diagnostics: {
      availableMetrics: stringArray(diagnosticsRecord.availableMetrics).length ? stringArray(diagnosticsRecord.availableMetrics) : availableMetricIds(metrics),
      missingMetrics: stringArray(diagnosticsRecord.missingMetrics).length ? stringArray(diagnosticsRecord.missingMetrics) : missingMetricIds(metrics),
      notes: stringArray(diagnosticsRecord.notes).length ? stringArray(diagnosticsRecord.notes) : ["Imported from normalized DefiLlama metrics handoff."],
    },
    sourceStats: isRecord(record.sourceStats) ? record.sourceStats : undefined,
    provenance: provenanceRecord,
  };
}

export async function ingestBusinessMetricsHandoff(options: IngestBusinessMetricsHandoffOptions): Promise<CmoBusinessMetricsSnapshot> {
  const snapshot = normalizeBusinessMetricsHandoffPayload(options.appId, options.payload);

  if (!options.dryRun) {
    const filePath = businessMetricsFilePath(snapshot.appId, snapshot.source.type, snapshot.metricGroup);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  return snapshot;
}

export async function readBusinessMetricsSnapshot(options: ReadBusinessMetricsOptions): Promise<CmoBusinessMetricsSnapshot | null> {
  const source = options.source === SUPPORTED_SOURCE || !options.source ? SUPPORTED_SOURCE : null;
  const group = businessGroup(options.group);

  if (options.appId !== SUPPORTED_APP_ID || !source || !group) {
    return null;
  }

  const app = getAppWorkspace(options.appId);

  if (!app) {
    return null;
  }

  const fallback: CmoBusinessMetricsSnapshot = {
    schemaVersion: "cmo.business-metrics.v1",
    workspaceId: app.workspaceId,
    appId: app.id,
    sourceId: app.sourceId,
    source: {
      type: source,
      fetchedAt: new Date(0).toISOString(),
      label: "DefiLlama",
    },
    metricDomain: SUPPORTED_DOMAIN,
    metricGroup: group,
    dateRange: {
      timezone: DEFAULT_TIMEZONE,
    },
    status: "missing",
    lastUpdatedAt: null,
    metrics: metricDefinitions(group).map(defaultMetric),
    diagnostics: {
      availableMetrics: [],
      missingMetrics: metricDefinitions(group).map((metric) => metric.id),
      notes: ["No DefiLlama business metrics handoff file connected yet."],
    },
  };

  try {
    const value = JSON.parse(await readFile(businessMetricsFilePath(app.id, source, group), "utf8")) as unknown;
    const snapshot = normalizeSnapshot(value, fallback);
    const metrics = snapshot.metrics;

    return {
      ...snapshot,
      status: snapshotStatus(metrics),
      diagnostics: {
        availableMetrics: availableMetricIds(metrics),
        missingMetrics: missingMetricIds(metrics),
        notes: snapshot.diagnostics.notes.length ? snapshot.diagnostics.notes : ["Loaded from DefiLlama business metrics handoff."],
      },
    };
  } catch {
    return fallback;
  }
}
