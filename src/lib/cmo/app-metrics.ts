import { readFile } from "fs/promises";
import path from "path";

import { readAppChatSessions } from "@/lib/cmo/app-chat-store";
import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import type {
  CmoAppMetric,
  CmoAppMetricDateRangePreset,
  CmoAppMetricsSnapshot,
  CmoMetricStatus,
} from "@/lib/cmo/app-workspace-types";
import { readLatestAppPromotion } from "@/lib/cmo/vault-files";

const APP_METRICS_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "app-metrics");
const DEFAULT_TIMEZONE = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon";
const SUPPORTED_APP_ID = "holdstation-mini-app";

const metricDefinitions: Array<Pick<CmoAppMetric, "id" | "label" | "unit" | "description">> = [
  {
    id: "activated_users",
    label: "Activated Users",
    unit: "users",
    description: "Users who reached the defined activation event.",
  },
  {
    id: "activation_rate",
    label: "Activation Rate",
    unit: "percent",
    description: "Share of new users who activated in the selected period.",
  },
  {
    id: "new_users",
    label: "New Users",
    unit: "users",
    description: "New users acquired in the selected period.",
  },
  {
    id: "d1_retention",
    label: "D1 Retention",
    unit: "percent",
    description: "Day-one retention for the selected cohort.",
  },
  {
    id: "d7_retention",
    label: "D7 Retention",
    unit: "percent",
    description: "Day-seven retention for the selected cohort.",
  },
  {
    id: "pending_reviews",
    label: "Pending Reviews",
    unit: "count",
    description: "Decision Layer outputs awaiting review.",
  },
  {
    id: "promotions_pending",
    label: "Promotions Pending",
    unit: "count",
    description: "Latest app-scoped promotion signal awaiting review.",
  },
];

export interface ReadAppMetricsOptions {
  appId: string;
  range?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  compare?: string | boolean | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metricStatus(value: unknown, fallback: CmoMetricStatus = "missing"): CmoMetricStatus {
  return value === "connected" || value === "missing" || value === "partial" || value === "placeholder" ? value : fallback;
}

function metricPreset(value: unknown): CmoAppMetricDateRangePreset {
  return value === "this_week" || value === "last_7_days" || value === "last_30_days" || value === "this_month" || value === "custom" ? value : "this_week";
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function zonedDateParts(value: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? "0");

  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
  };
}

function dateFromParts(parts: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function validDateString(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : value;
}

export function resolveAppMetricsDateRange({
  preset,
  startDate,
  endDate,
  timezone = DEFAULT_TIMEZONE,
  now = new Date(),
}: {
  preset: CmoAppMetricDateRangePreset;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string;
  now?: Date;
}): CmoAppMetricsSnapshot["dateRange"] {
  const today = dateFromParts(zonedDateParts(now, timezone));
  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(today);
  const end = new Date(today);

  if (preset === "custom") {
    return {
      preset,
      startDate: validDateString(startDate) ?? isoDate(start),
      endDate: validDateString(endDate) ?? isoDate(end),
      timezone,
    };
  }

  if (preset === "last_7_days") {
    start.setUTCDate(today.getUTCDate() - 6);
  } else if (preset === "last_30_days") {
    start.setUTCDate(today.getUTCDate() - 29);
  } else if (preset === "this_month") {
    start.setUTCDate(1);
  } else {
    start.setUTCDate(today.getUTCDate() + mondayOffset);
  }

  return {
    preset,
    startDate: isoDate(start),
    endDate: isoDate(end),
    timezone,
  };
}

function defaultMetric(definition: Pick<CmoAppMetric, "id" | "label" | "unit" | "description">): CmoAppMetric {
  return {
    ...definition,
    value: null,
    displayValue: "No data",
    trend: "unknown",
    status: "missing",
  };
}

function normalizeMetric(value: unknown): CmoAppMetric | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const definition = metricDefinitions.find((item) => item.id === value.id);
  const numericValue = typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
  const deltaValue = typeof value.deltaValue === "number" && Number.isFinite(value.deltaValue) ? value.deltaValue : null;
  const status = metricStatus(value.status, numericValue === null ? "missing" : "connected");

  return {
    id: value.id,
    label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : definition?.label ?? value.id,
    value: numericValue,
    displayValue: typeof value.displayValue === "string" && value.displayValue.trim() ? value.displayValue.trim() : numericValue === null ? "No data" : String(numericValue),
    unit: value.unit === "users" || value.unit === "percent" || value.unit === "count" || value.unit === "ratio" ? value.unit : definition?.unit,
    deltaValue,
    deltaDisplay: typeof value.deltaDisplay === "string" && value.deltaDisplay.trim() ? value.deltaDisplay.trim() : undefined,
    trend: value.trend === "up" || value.trend === "down" || value.trend === "flat" || value.trend === "unknown" ? value.trend : "unknown",
    status,
    description: typeof value.description === "string" && value.description.trim() ? value.description.trim() : definition?.description,
  };
}

function normalizeSnapshot(value: unknown, fallback: CmoAppMetricsSnapshot): CmoAppMetricsSnapshot {
  if (!isRecord(value)) {
    return fallback;
  }

  const parsedMetrics = Array.isArray(value.metrics) ? value.metrics.map(normalizeMetric).filter((metric): metric is CmoAppMetric => Boolean(metric)) : [];
  const mergedMetrics = metricDefinitions.map((definition) => parsedMetrics.find((metric) => metric.id === definition.id) ?? defaultMetric(definition));
  const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : {};

  return {
    ...fallback,
    status: metricStatus(value.status, fallback.status),
    lastUpdatedAt: typeof value.lastUpdatedAt === "string" ? value.lastUpdatedAt : null,
    metrics: mergedMetrics,
    diagnostics: {
      source: diagnostics.source === "json" || diagnostics.source === "placeholder" || diagnostics.source === "not_connected" ? diagnostics.source : "json",
      missingMetrics: Array.isArray(diagnostics.missingMetrics) ? diagnostics.missingMetrics.filter((item): item is string => typeof item === "string") : [],
      notes: Array.isArray(diagnostics.notes) ? diagnostics.notes.filter((item): item is string => typeof item === "string") : [],
    },
  };
}

function snapshotStatus(metrics: CmoAppMetric[]): CmoMetricStatus {
  const connectedCount = metrics.filter((metric) => metric.status === "connected").length;

  if (connectedCount === metrics.length) {
    return "connected";
  }

  if (connectedCount > 0) {
    return "partial";
  }

  return "missing";
}

function missingMetricIds(metrics: CmoAppMetric[]): string[] {
  return metrics.filter((metric) => metric.status !== "connected" || metric.value === null).map((metric) => metric.id);
}

async function readMetricsFile(appId: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path.join(APP_METRICS_DIR, `${appId}.json`), "utf8")) as unknown;
  } catch {
    return null;
  }
}

function pendingReviewCount(session: Awaited<ReturnType<typeof readAppChatSessions>>[number]): number {
  const layer = session.decisionLayer;

  if (!layer) {
    return 0;
  }

  return [
    ...layer.decisions.map((item) => item.reviewStatus ?? "unreviewed"),
    ...layer.assumptions.map((item) => item.reviewStatus ?? "unreviewed"),
    ...layer.suggestedActions.map((item) => item.reviewStatus ?? "unreviewed"),
    ...layer.memoryCandidates.map((item) => item.reviewStatus),
    ...layer.taskCandidates.map((item) => item.reviewStatus ?? "unreviewed"),
  ].filter((status) => status === "unreviewed" || status === "review_required").length;
}

function withMetric(metrics: CmoAppMetric[], id: string, next: Partial<CmoAppMetric>): CmoAppMetric[] {
  return metrics.map((metric) => (metric.id === id ? { ...metric, ...next } : metric));
}

export async function readAppMetricsSnapshot(options: ReadAppMetricsOptions): Promise<CmoAppMetricsSnapshot | null> {
  if (options.appId !== SUPPORTED_APP_ID) {
    return null;
  }

  const app = getAppWorkspace(options.appId);

  if (!app) {
    return null;
  }

  const preset = metricPreset(options.range);
  const compareToPrevious = options.compare === true || options.compare === "true";
  const dateRange = resolveAppMetricsDateRange({
    preset,
    startDate: options.startDate,
    endDate: options.endDate,
  });
  const fallback: CmoAppMetricsSnapshot = {
    schemaVersion: "cmo.app-metrics.v1",
    workspaceId: app.workspaceId,
    appId: app.id,
    sourceId: app.sourceId,
    dateRange,
    compareToPrevious,
    status: "missing",
    lastUpdatedAt: null,
    metrics: metricDefinitions.map(defaultMetric),
    diagnostics: {
      source: "not_connected",
      missingMetrics: metricDefinitions.map((metric) => metric.id),
      notes: ["No metrics source connected yet."],
    },
  };
  const fileSnapshot = normalizeSnapshot(await readMetricsFile(app.id), fallback);
  const sessions = await readAppChatSessions(50, app.id);
  const latestPromotion = await readLatestAppPromotion(app);
  const pendingReviews = sessions.reduce((total, session) => total + pendingReviewCount(session), 0);
  let metrics = withMetric(fileSnapshot.metrics, "pending_reviews", {
    value: pendingReviews,
    displayValue: String(pendingReviews),
    status: "connected",
    trend: "unknown",
  });

  metrics = withMetric(metrics, "promotions_pending", {
    value: latestPromotion ? 1 : 0,
    displayValue: latestPromotion ? "1" : "0",
    status: "connected",
    trend: "unknown",
  });

  const notes = [
    ...fileSnapshot.diagnostics.notes,
    "Product analytics are not connected in Phase 2.2.",
    compareToPrevious ? "No comparison data is available yet." : "",
  ].filter(Boolean);

  return {
    ...fileSnapshot,
    dateRange,
    compareToPrevious,
    status: snapshotStatus(metrics),
    metrics,
    diagnostics: {
      source: fileSnapshot.diagnostics.source,
      missingMetrics: missingMetricIds(metrics),
      notes,
    },
  };
}
