import "server-only";

import { getLensGoogleAccessToken } from "@/lib/cmo/lens-google-oauth";
import type { WorkspaceGa4MetricSourceMapping } from "@/lib/cmo/workspace-metric-sources";
import type {
  WorkspaceGa4CoreMetrics,
  WorkspaceGa4MetricRangeKey,
} from "@/lib/cmo/workspace-metric-snapshots";

export type LensGa4DataErrorCode =
  | "source_mapping_not_found"
  | "source_not_verified"
  | "source_auth_failed"
  | "ga4_data_api_unavailable"
  | "ga4_data_api_failed";

interface GoogleAnalyticsDataApiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      reason?: string;
      service?: string;
      metadata?: Record<string, string>;
    }>;
  };
}

interface GoogleRunReportResponse {
  metricHeaders?: Array<{ name?: string; type?: string }>;
  rows?: Array<{
    metricValues?: Array<{ value?: string }>;
  }>;
}

export interface LensGa4DateRange {
  rangeKey: WorkspaceGa4MetricRangeKey;
  dateStart: string;
  dateEnd: string;
  timezone: string;
  mode: "week_to_date" | "rolling_calendar_days" | "month_to_date";
}

export interface LensGa4CoreMetricsResult {
  range: LensGa4DateRange;
  metrics: WorkspaceGa4CoreMetrics;
  sourceMeta: {
    propertyId: string;
    propertyDisplayName?: string;
    accountDisplayName?: string;
    metricNames: string[];
  };
}

export class LensGa4DataError extends Error {
  code: LensGa4DataErrorCode;

  constructor(code: LensGa4DataErrorCode, message: string) {
    super(message);
    this.name = "LensGa4DataError";
    this.code = code;
  }
}

const DEFAULT_TIMEZONE = "Asia/Saigon";

const CORE_GA4_METRIC_NAMES = [
  "activeUsers",
  "newUsers",
  "totalUsers",
  "sessions",
  "engagedSessions",
  "engagementRate",
  "eventCount",
  "userEngagementDuration",
] as const;

function timezoneParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  weekday: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: value("weekday"),
  };
}

function dateString(parts: { year: number; month: number; day: number }): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));

  return dateString({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

function weekdayIndex(weekday: string): number {
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);

  return index >= 0 ? index + 1 : 1;
}

function normalizeTimezone(value: string | null | undefined): string {
  const timezone = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function resolveLensGa4DateRange(input: {
  rangeKey: WorkspaceGa4MetricRangeKey;
  timezone?: string | null;
  now?: Date;
}): LensGa4DateRange {
  const timezone = normalizeTimezone(input.timezone);
  const now = input.now ?? new Date();
  const todayParts = timezoneParts(now, timezone);
  const today = dateString(todayParts);

  if (input.rangeKey === "this_week") {
    return {
      rangeKey: input.rangeKey,
      dateStart: addDays(today, -(weekdayIndex(todayParts.weekday) - 1)),
      dateEnd: today,
      timezone,
      mode: "week_to_date",
    };
  }

  if (input.rangeKey === "this_month") {
    return {
      rangeKey: input.rangeKey,
      dateStart: dateString({ year: todayParts.year, month: todayParts.month, day: 1 }),
      dateEnd: today,
      timezone,
      mode: "month_to_date",
    };
  }

  const days = input.rangeKey === "last_30_days" ? 30 : 7;

  return {
    rangeKey: input.rangeKey,
    dateStart: addDays(today, -(days - 1)),
    dateEnd: today,
    timezone,
    mode: "rolling_calendar_days",
  };
}

function dataApiErrorCode(status: number, payload: GoogleAnalyticsDataApiErrorPayload): LensGa4DataErrorCode {
  const errorText = JSON.stringify(payload).toLowerCase();

  if (status === 401 || status === 403 && errorText.includes("invalid_grant")) {
    return "source_auth_failed";
  }

  if (status === 403 && (errorText.includes("service_disabled") || errorText.includes("has not been used") || errorText.includes("disabled"))) {
    return "ga4_data_api_unavailable";
  }

  if (status === 429 || status >= 500) {
    return "ga4_data_api_unavailable";
  }

  return "ga4_data_api_failed";
}

function parseMetricValue(value: string | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRunReportMetrics(payload: GoogleRunReportResponse): WorkspaceGa4CoreMetrics {
  const headers = payload.metricHeaders ?? [];
  const values = payload.rows?.[0]?.metricValues ?? [];
  const byName = new Map<string, number | null>();

  headers.forEach((header, index) => {
    if (header.name) {
      byName.set(header.name, parseMetricValue(values[index]?.value));
    }
  });

  return {
    activeUsers: byName.get("activeUsers") ?? null,
    newUsers: byName.get("newUsers") ?? null,
    totalUsers: byName.get("totalUsers") ?? null,
    sessions: byName.get("sessions") ?? null,
    engagedSessions: byName.get("engagedSessions") ?? null,
    engagementRate: byName.get("engagementRate") ?? null,
    eventCount: byName.get("eventCount") ?? null,
    userEngagementDuration: byName.get("userEngagementDuration") ?? null,
  };
}

async function runGa4CoreMetricsReport(input: {
  accessToken: string;
  propertyId: string;
  range: LensGa4DateRange;
}): Promise<WorkspaceGa4CoreMetrics> {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(input.propertyId)}:runReport`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      dateRanges: [
        {
          startDate: input.range.dateStart,
          endDate: input.range.dateEnd,
        },
      ],
      metrics: CORE_GA4_METRIC_NAMES.map((name) => ({ name })),
      keepEmptyRows: true,
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleRunReportResponse & GoogleAnalyticsDataApiErrorPayload;

  if (!response.ok) {
    const code = dataApiErrorCode(response.status, payload);
    throw new LensGa4DataError(code, code);
  }

  return normalizeRunReportMetrics(payload);
}

export async function fetchLensGa4CoreMetrics(input: {
  tenantId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
  mapping: WorkspaceGa4MetricSourceMapping | null;
}): Promise<LensGa4CoreMetricsResult> {
  const mapping = input.mapping;

  if (!mapping?.enabled || !mapping.propertyId || !mapping.oauthAccountId) {
    throw new LensGa4DataError("source_mapping_not_found", "source_mapping_not_found");
  }

  if (mapping.verificationStatus !== "verified") {
    throw new LensGa4DataError("source_not_verified", "source_not_verified");
  }

  const range = resolveLensGa4DateRange({
    rangeKey: input.rangeKey,
    timezone: mapping.timezone,
  });
  const token = await getLensGoogleAccessToken({
    oauthAccountId: mapping.oauthAccountId,
    tenantId: input.tenantId,
  });
  const metrics = await runGa4CoreMetricsReport({
    accessToken: token.accessToken,
    propertyId: mapping.propertyId,
    range,
  });

  return {
    range,
    metrics,
    sourceMeta: {
      propertyId: mapping.propertyId,
      propertyDisplayName: mapping.propertyDisplayName,
      accountDisplayName: mapping.accountDisplayName,
      metricNames: [...CORE_GA4_METRIC_NAMES],
    },
  };
}
