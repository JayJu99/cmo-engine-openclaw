import { readFile } from "fs/promises";
import path from "path";

import { getAppWorkspace } from "@/lib/cmo/app-workspaces";
import type {
  CmoChannel,
  CmoChannelMetric,
  CmoChannelMetricDateRangePreset,
  CmoChannelMetricsSyncStatus,
  CmoChannelMetricsSnapshot,
  CmoTopContentItem,
} from "@/lib/cmo/app-workspace-types";

const CHANNEL_METRICS_DIR = path.join(process.cwd(), "data", "cmo-dashboard", "channel-metrics");
const DEFAULT_TIMEZONE = process.env.CMO_VAULT_TIME_ZONE ?? "Asia/Saigon";
const SUPPORTED_APP_ID = "holdstation-mini-app";
const SUPPORTED_CHANNEL: CmoChannel = "facebook";
const LENS_FACEBOOK_OUTPUT_PATH = "/home/ju/.openclaw/workspace/knowledge/holdstation/07 Knowledge/Data/facebook-page/processed/cmo-channel-metrics-facebook.json";

const channelMetricDefinitions: Array<Pick<CmoChannelMetric, "id" | "label" | "unit" | "description" | "caveat">> = [
  {
    id: "facebook_views",
    label: "Facebook Views",
    unit: "count",
    description: "Facebook content/page views reported by Lens when available.",
    caveat: "Reach/impressions may use Meta media view proxies.",
  },
  {
    id: "facebook_unique_views",
    label: "Unique Views Proxy",
    unit: "count",
    description: "Unique media/page view proxy reported by Lens when available.",
    caveat: "This is a unique views proxy, not confirmed classic reach.",
  },
  {
    id: "facebook_engagement",
    label: "Engagement",
    unit: "count",
    description: "Visible engagement or page post engagement reported by Lens.",
  },
  {
    id: "facebook_post_count",
    label: "Post Count",
    unit: "count",
    description: "Processed Facebook posts in the selected range.",
  },
  {
    id: "facebook_video_views",
    label: "Video Views",
    unit: "count",
    description: "Facebook video views reported by Lens when available.",
  },
  {
    id: "facebook_follower_count",
    label: "Followers",
    unit: "count",
    description: "Facebook Page follower count when available.",
  },
  {
    id: "facebook_follower_growth",
    label: "Follower Growth",
    unit: "count",
    description: "Follower growth from Lens if supplied or safely calculated upstream.",
  },
  {
    id: "facebook_link_clicks",
    label: "Link Clicks",
    unit: "count",
    description: "Facebook link clicks from Lens if confirmed.",
  },
  {
    id: "facebook_ctr",
    label: "CTR",
    unit: "percent",
    description: "Facebook click-through rate from Lens if confirmed.",
  },
];

export interface ReadChannelMetricsOptions {
  appId: string;
  channel?: string | null;
  range?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function channelPreset(value: unknown): CmoChannelMetricDateRangePreset {
  return value === "today" ||
    value === "yesterday" ||
    value === "last_7_days" ||
    value === "last_30_days" ||
    value === "this_week" ||
    value === "this_month" ||
    value === "custom"
    ? value
    : "this_week";
}

function channelStatus(value: unknown, fallback: CmoChannelMetric["status"] = "missing"): CmoChannelMetric["status"] {
  return value === "connected" || value === "missing" || value === "partial" || value === "placeholder" ? value : fallback;
}

function channelDefinition(id: string): Pick<CmoChannelMetric, "id" | "label" | "unit" | "description" | "caveat"> | undefined {
  return channelMetricDefinitions.find((item) => item.id === id);
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

export function resolveChannelMetricsDateRange({
  preset,
  startDate,
  endDate,
  timezone = DEFAULT_TIMEZONE,
  now = new Date(),
}: {
  preset: CmoChannelMetricDateRangePreset;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string;
  now?: Date;
}): CmoChannelMetricsSnapshot["dateRange"] {
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

  if (preset === "yesterday") {
    start.setUTCDate(today.getUTCDate() - 1);
    end.setUTCDate(today.getUTCDate() - 1);
  } else if (preset === "last_7_days") {
    start.setUTCDate(today.getUTCDate() - 6);
  } else if (preset === "last_30_days") {
    start.setUTCDate(today.getUTCDate() - 29);
  } else if (preset === "this_month") {
    start.setUTCDate(1);
  } else if (preset === "this_week") {
    start.setUTCDate(today.getUTCDate() + mondayOffset);
  }

  return {
    preset,
    startDate: isoDate(start),
    endDate: isoDate(end),
    timezone,
  };
}

function defaultMetric(definition: Pick<CmoChannelMetric, "id" | "label" | "unit" | "description" | "caveat">): CmoChannelMetric {
  return {
    ...definition,
    value: null,
    displayValue: "No data",
    status: "missing",
  };
}

function normalizeMetric(value: unknown): CmoChannelMetric | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const definition = channelDefinition(value.id);

  if (!definition) {
    return null;
  }

  const numericValue = typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
  const status = channelStatus(value.status, numericValue === null ? "missing" : "connected");

  return {
    id: definition.id,
    label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : definition.label,
    value: numericValue,
    displayValue: typeof value.displayValue === "string" && value.displayValue.trim() ? value.displayValue.trim() : numericValue === null ? "No data" : String(numericValue),
    unit: value.unit === "count" || value.unit === "percent" || value.unit === "ratio" ? value.unit : definition.unit,
    status: numericValue === null && status === "connected" ? "missing" : status,
    description: typeof value.description === "string" && value.description.trim() ? value.description.trim() : definition.description,
    caveat: typeof value.caveat === "string" && value.caveat.trim() ? value.caveat.trim() : definition.caveat,
  };
}

function normalizeTopPost(value: unknown, index: number): CmoTopContentItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : typeof value.postId === "string" && value.postId.trim() ? value.postId.trim() : `top-post-${index + 1}`;

  return {
    id,
    postId: typeof value.postId === "string" && value.postId.trim() ? value.postId.trim() : undefined,
    createdTime: typeof value.createdTime === "string" && value.createdTime.trim() ? value.createdTime.trim() : undefined,
    permalinkUrl: typeof value.permalinkUrl === "string" && value.permalinkUrl.trim() ? value.permalinkUrl.trim() : undefined,
    messagePreview: typeof value.messagePreview === "string" && value.messagePreview.trim() ? value.messagePreview.trim() : undefined,
    inferredContentType: typeof value.inferredContentType === "string" && value.inferredContentType.trim() ? value.inferredContentType.trim() : undefined,
    views: typeof value.views === "number" && Number.isFinite(value.views) ? value.views : null,
    visibleEngagement: typeof value.visibleEngagement === "number" && Number.isFinite(value.visibleEngagement) ? value.visibleEngagement : null,
    engagementRate: typeof value.engagementRate === "number" && Number.isFinite(value.engagementRate) ? value.engagementRate : null,
    bucket: value.bucket === "viral" || value.bucket === "strong" || value.bucket === "normal" || value.bucket === "low_sample" || value.bucket === "unknown" ? value.bucket : "unknown",
  };
}

function snapshotStatus(metrics: CmoChannelMetric[]): CmoChannelMetricsSnapshot["status"] {
  const connectedCount = metrics.filter((metric) => metric.status === "connected").length;

  if (connectedCount === metrics.length) {
    return "connected";
  }

  if (connectedCount > 0) {
    return "partial";
  }

  return "missing";
}

function missingMetricIds(metrics: CmoChannelMetric[]): string[] {
  return metrics.filter((metric) => metric.status !== "connected" || metric.value === null).map((metric) => metric.id);
}

function availableMetricIds(metrics: CmoChannelMetric[]): string[] {
  return metrics.filter((metric) => metric.status === "connected" && metric.value !== null).map((metric) => metric.id);
}

function normalizeSnapshot(value: unknown, fallback: CmoChannelMetricsSnapshot): CmoChannelMetricsSnapshot {
  if (!isRecord(value)) {
    return fallback;
  }

  if (
    value.schemaVersion !== "cmo.channel-metrics.v1" ||
    value.workspaceId !== fallback.workspaceId ||
    value.appId !== fallback.appId ||
    value.sourceId !== fallback.sourceId ||
    value.channel !== fallback.channel
  ) {
    return {
      ...fallback,
      diagnostics: {
        ...fallback.diagnostics,
        notes: [...fallback.diagnostics.notes, "Ignored channel metrics file because its app scope did not match."],
      },
    };
  }

  const parsedMetrics = Array.isArray(value.metrics) ? value.metrics.map(normalizeMetric).filter((metric): metric is CmoChannelMetric => Boolean(metric)) : [];
  const metrics = channelMetricDefinitions.map((definition) => parsedMetrics.find((metric) => metric.id === definition.id) ?? defaultMetric(definition));
  const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : {};
  const topPosts = Array.isArray(value.topPosts)
    ? value.topPosts.map(normalizeTopPost).filter((item): item is CmoTopContentItem => Boolean(item)).slice(0, 3)
    : undefined;

  return {
    ...fallback,
    source: value.source === "lens.facebook_page" || value.source === "placeholder" || value.source === "not_connected" ? value.source : "placeholder",
    status: channelStatus(value.status, snapshotStatus(metrics)),
    lastUpdatedAt: typeof value.lastUpdatedAt === "string" && !Number.isNaN(Date.parse(value.lastUpdatedAt)) ? value.lastUpdatedAt : null,
    metrics,
    topPosts,
    diagnostics: {
      availableMetrics: Array.isArray(diagnostics.availableMetrics) ? diagnostics.availableMetrics.filter((item): item is string => typeof item === "string") : availableMetricIds(metrics),
      missingMetrics: Array.isArray(diagnostics.missingMetrics) ? diagnostics.missingMetrics.filter((item): item is string => typeof item === "string") : missingMetricIds(metrics),
      notes: Array.isArray(diagnostics.notes) ? diagnostics.notes.filter((item): item is string => typeof item === "string") : [],
    },
  };
}

async function readMetricsFile(appId: string, channel: CmoChannel): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(channelMetricsFilePath(appId, channel), "utf8")) as unknown;
  } catch {
    return null;
  }
}

function channelMetricsFilePath(appId: string, channel: CmoChannel): string {
  return path.join(CHANNEL_METRICS_DIR, appId, `${channel}.json`);
}

function channelMetricsSyncStatusFilePath(appId: string, channel: CmoChannel): string {
  return path.join(CHANNEL_METRICS_DIR, appId, `${channel}-sync-status.json`);
}

function validSyncStatus(value: unknown): CmoChannelMetricsSyncStatus["status"] {
  return value === "success" || value === "failed" || value === "partial" || value === "skipped" ? value : "skipped";
}

function nullableIsoString(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeSyncStatus(value: unknown, fallback: CmoChannelMetricsSyncStatus): CmoChannelMetricsSyncStatus {
  if (!isRecord(value)) {
    return fallback;
  }

  if (
    value.schemaVersion !== "cmo.channel-metrics-sync-status.v1" ||
    value.appId !== fallback.appId ||
    value.channel !== fallback.channel
  ) {
    return fallback;
  }

  return {
    schemaVersion: "cmo.channel-metrics-sync-status.v1",
    appId: fallback.appId,
    channel: fallback.channel,
    status: validSyncStatus(value.status),
    lastStartedAt: nullableIsoString(value.lastStartedAt),
    lastFinishedAt: nullableIsoString(value.lastFinishedAt),
    lastSuccessAt: nullableIsoString(value.lastSuccessAt),
    lastErrorAt: nullableIsoString(value.lastErrorAt),
    lastErrorMessage: typeof value.lastErrorMessage === "string" && value.lastErrorMessage.trim() ? value.lastErrorMessage.trim() : null,
    normalizedOutputPath: typeof value.normalizedOutputPath === "string" && value.normalizedOutputPath.trim() ? value.normalizedOutputPath.trim() : fallback.normalizedOutputPath,
    lensOutputPath: typeof value.lensOutputPath === "string" && value.lensOutputPath.trim() ? value.lensOutputPath.trim() : fallback.lensOutputPath,
    availableMetrics: stringArray(value.availableMetrics),
    missingMetrics: stringArray(value.missingMetrics),
    notes: stringArray(value.notes),
  };
}

export async function readChannelMetricsSnapshot(options: ReadChannelMetricsOptions): Promise<CmoChannelMetricsSnapshot | null> {
  const channel = options.channel === SUPPORTED_CHANNEL || !options.channel ? SUPPORTED_CHANNEL : null;

  if (options.appId !== SUPPORTED_APP_ID || !channel) {
    return null;
  }

  const app = getAppWorkspace(options.appId);

  if (!app) {
    return null;
  }

  const dateRange = resolveChannelMetricsDateRange({
    preset: channelPreset(options.range),
    startDate: options.startDate,
    endDate: options.endDate,
  });
  const fallback: CmoChannelMetricsSnapshot = {
    schemaVersion: "cmo.channel-metrics.v1",
    workspaceId: app.workspaceId,
    appId: app.id,
    sourceId: app.sourceId,
    channel,
    source: "not_connected",
    dateRange,
    status: "missing",
    lastUpdatedAt: null,
    metrics: channelMetricDefinitions.map(defaultMetric),
    diagnostics: {
      availableMetrics: [],
      missingMetrics: channelMetricDefinitions.map((metric) => metric.id),
      notes: ["No Lens Facebook channel metrics file connected yet."],
    },
  };
  const fileSnapshot = normalizeSnapshot(await readMetricsFile(app.id, channel), fallback);
  const metrics = fileSnapshot.metrics;

  return {
    ...fileSnapshot,
    dateRange,
    status: snapshotStatus(metrics),
    diagnostics: {
      availableMetrics: availableMetricIds(metrics),
      missingMetrics: missingMetricIds(metrics),
      notes: fileSnapshot.diagnostics.notes.length
        ? fileSnapshot.diagnostics.notes
        : fileSnapshot.source === "lens.facebook_page"
          ? ["Loaded from normalized Lens Facebook file bridge."]
          : ["No Lens Facebook channel metrics file connected yet."],
    },
  };
}

export async function readChannelMetricsSyncStatus(options: Pick<ReadChannelMetricsOptions, "appId" | "channel">): Promise<CmoChannelMetricsSyncStatus | null> {
  const channel = options.channel === SUPPORTED_CHANNEL || !options.channel ? SUPPORTED_CHANNEL : null;

  if (options.appId !== SUPPORTED_APP_ID || !channel) {
    return null;
  }

  const app = getAppWorkspace(options.appId);

  if (!app) {
    return null;
  }

  const fallback: CmoChannelMetricsSyncStatus = {
    schemaVersion: "cmo.channel-metrics-sync-status.v1",
    appId: app.id,
    channel,
    status: "skipped",
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    normalizedOutputPath: channelMetricsFilePath(app.id, channel),
    lensOutputPath: LENS_FACEBOOK_OUTPUT_PATH,
    availableMetrics: [],
    missingMetrics: channelMetricDefinitions.map((metric) => metric.id),
    notes: ["Manual refresh only. No Lens sync status file has been written yet."],
  };

  try {
    const value = JSON.parse(await readFile(channelMetricsSyncStatusFilePath(app.id, channel), "utf8")) as unknown;
    return normalizeSyncStatus(value, fallback);
  } catch {
    return fallback;
  }
}
