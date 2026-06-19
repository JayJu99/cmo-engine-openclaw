"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import { AppMemorySection } from "@/components/cmo-apps/app-memory-section";
import { CMOChatPanel } from "@/components/cmo-apps/cmo-chat-panel";
import { ContextBriefCard } from "@/components/cmo-apps/context-brief-card";
import { PromotionCandidatesSection } from "@/components/cmo-apps/promotion-candidates-section";
import { ProjectContextImportCard } from "@/components/cmo-apps/project-context-import-card";
import type { AppWorkspaceState } from "@/lib/cmo/vault-files";
import type {
  AppPlanType,
  AppWorkspacePlanState,
  AppWorkspaceTab,
  CmoAppMetric,
  CmoAppMetricDateRangePreset,
  CmoAppMetricsSnapshot,
  CmoBusinessMetric,
  CmoBusinessMetricsSnapshot,
  CmoChannelMetric,
  CmoChannelMetricsSyncStatus,
  CmoChannelMetricsSnapshot,
  CMOChatSession,
  CMORuntimeStatus,
} from "@/lib/cmo/app-workspace-types";
import { cn } from "@/lib/utils";

const tabs: Array<{ id: AppWorkspaceTab; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "inputs", label: "Inputs & Priorities" },
  { id: "plan", label: "Plan & Recap" },
  { id: "tasks", label: "Tasks" },
  { id: "sessions", label: "CMO Sessions" },
];

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const message = typeof record?.error === "string" ? record.error : "Request failed";

    throw new Error(`${response.status} ${message}`);
  }

  return payload as T;
}

function isWorkspaceTab(value: string | null): value is AppWorkspaceTab {
  return value === "dashboard" || value === "inputs" || value === "plan" || value === "tasks" || value === "sessions";
}

function workspaceTabFromParam(value: string | null): AppWorkspaceTab {
  if (value === "chat") {
    return "sessions";
  }

  return isWorkspaceTab(value) ? value : "dashboard";
}

function runtimeLabel(status: CMORuntimeStatus | undefined): string {
  if (status === "connected" || status === "live" || status === "configured_but_unreachable") {
    return "CMO Hermes Active";
  }

  if (status === "live_failed_then_fallback" || status === "development_fallback") {
    return "Workspace Context Active";
  }

  if (status === "runtime_error") {
    return "CMO needs attention";
  }

  if (status === "not_configured") {
    return "CMO setup pending";
  }

  return "CMO status checking";
}

function runtimeVariant(status: CMORuntimeStatus | undefined): "green" | "orange" | "red" | "slate" {
  if (status === "connected" || status === "live" || status === "configured_but_unreachable") {
    return "green";
  }

  if (status === "runtime_error") {
    return "red";
  }

  if (status === "development_fallback" || status === "not_configured" || status === "live_failed_then_fallback") {
    return "orange";
  }

  return "slate";
}

function displayDate(value: string | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function compactMetricValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "No data";
  }

  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function percentMetricValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "No data";
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value * 100)}%`;
}

function ga4DashboardRangeKey(dateRange: CmoAppMetricDateRangePreset): WorkspaceGa4DashboardRangeKey {
  return dateRange === "custom" ? "this_week" : dateRange;
}

function ga4SnapshotStaleThresholdMs(rangeKey: WorkspaceGa4DashboardRangeKey): number {
  return rangeKey === "last_30_days" || rangeKey === "this_month"
    ? 48 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
}

function isGa4SnapshotStale(snapshot: WorkspaceGa4MetricSnapshot | null, rangeKey: WorkspaceGa4DashboardRangeKey): boolean {
  if (!snapshot?.syncedAt || snapshot.status !== "synced") {
    return false;
  }

  const syncedAt = Date.parse(snapshot.syncedAt);

  return Number.isFinite(syncedAt) && Date.now() - syncedAt > ga4SnapshotStaleThresholdMs(rangeKey);
}

function ga4SnapshotHealthLabel(input: {
  loadStatus: "idle" | "loading" | "ready" | "syncing" | "error";
  snapshot: WorkspaceGa4MetricSnapshot | null;
  stale: boolean;
}): string {
  if (input.loadStatus === "loading") {
    return "Loading";
  }

  if (input.loadStatus === "syncing") {
    return "Syncing";
  }

  if (input.loadStatus === "error" || input.snapshot?.status === "error") {
    return "Error";
  }

  if (input.stale) {
    return "Stale";
  }

  return input.snapshot?.status === "synced" ? "Synced" : "No snapshot";
}

function ga4SnapshotHealthVariant(label: string): "green" | "orange" | "red" | "slate" {
  if (label === "Synced") {
    return "green";
  }

  if (label === "Error") {
    return "red";
  }

  return label === "Stale" || label === "Syncing" ? "orange" : "slate";
}

function isGa4SyncedNumber(snapshot: WorkspaceGa4MetricSnapshot | null, value: number | null | undefined): value is number {
  return snapshot?.status === "synced" && typeof value === "number" && Number.isFinite(value);
}

function definitionNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metricDefinitionRangeKey(dateRange: CmoAppMetricDateRangePreset): ProductMetricDefinitionSnapshot["range_key"] {
  return dateRange === "last_7_days" || dateRange === "last_30_days" ? dateRange : "this_week";
}

function metricDefinitionStatusLabel(status: ProductMetricDefinitionStatus | undefined): string {
  if (status === "computed") {
    return "Computed";
  }

  if (status === "configured_but_unavailable") {
    return "Calculation unavailable";
  }

  if (status === "not_matured") {
    return "Not enough mature data";
  }

  if (status === "no_denominator") {
    return "No denominator";
  }

  if (status === "no_data") {
    return "No matching data";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Metric definition needed";
}

function metricDefinitionStatusVariant(status: ProductMetricDefinitionStatus | undefined): "green" | "orange" | "red" | "slate" {
  if (status === "computed") {
    return "green";
  }

  if (status === "failed") {
    return "red";
  }

  return status ? "orange" : "slate";
}

function metricDefinitionCardCopy(input: {
  kind: "activation_users" | "activation_rate" | "retention_d1" | "retention_d7";
  snapshot: ProductMetricDefinitionSnapshot | undefined;
  definition: ProductMetricDefinition | undefined;
}): Pick<Parameters<typeof KpiCard>[0], "value" | "detail" | "muted" | "status"> {
  if (!input.definition?.enabled) {
    return {
      value: "No data",
      detail: "Requires activation/retention definition.",
      muted: true,
      status: <Badge variant="orange">Metric definition needed</Badge>,
    };
  }

  const snapshot = input.snapshot;

  if (!snapshot) {
    return {
      value: "No data",
      detail: "Configured. Compute now to populate this metric.",
      muted: true,
      status: <Badge variant="orange">Configured</Badge>,
    };
  }

  if (snapshot.status === "computed") {
    const metricKey = input.kind === "activation_users"
      ? "activated_users"
      : input.kind === "activation_rate"
        ? "activation_rate"
        : input.kind === "retention_d1"
          ? "d1_retention"
          : "d7_retention";
    const value = definitionNumber(snapshot.metrics[metricKey]);

    return {
      value: input.kind === "activation_users" ? compactMetricValue(value) : percentMetricValue(value),
      detail: `Last computed ${snapshot.generated_at ? displayDate(snapshot.generated_at) : "recently"}.`,
      muted: value === null,
      status: <Badge variant={metricDefinitionStatusVariant(snapshot.status)}>{metricDefinitionStatusLabel(snapshot.status)}</Badge>,
    };
  }

  if (snapshot.status === "not_matured") {
    return {
      value: "Configured",
      detail: "Configured, not enough mature data.",
      muted: true,
      status: <Badge variant="orange">{metricDefinitionStatusLabel(snapshot.status)}</Badge>,
    };
  }

  if (snapshot.status === "configured_but_unavailable") {
    return {
      value: "Configured",
      detail: "Configured, calculation unavailable.",
      muted: true,
      status: <Badge variant="orange">{metricDefinitionStatusLabel(snapshot.status)}</Badge>,
    };
  }

  return {
    value: "No data",
    detail: metricDefinitionStatusLabel(snapshot.status),
    muted: true,
    status: <Badge variant={metricDefinitionStatusVariant(snapshot.status)}>{metricDefinitionStatusLabel(snapshot.status)}</Badge>,
  };
}

function ga4VerificationBadgeVariant(input: {
  loading: boolean;
  mapping: WorkspaceGa4MetricSourceMapping | null;
  fallbackVariant: "green" | "orange" | "red" | "slate";
}): "green" | "orange" | "red" | "slate" {
  if (input.loading) {
    return "slate";
  }

  if (!input.mapping?.enabled) {
    return input.fallbackVariant;
  }

  if (input.mapping.verificationStatus === "verified") {
    return "green";
  }

  if (input.mapping.verificationStatus === "needs_reconnect" || input.mapping.verificationStatus === "property_inaccessible") {
    return "orange";
  }

  if (input.mapping.verificationStatus === "error") {
    return "red";
  }

  return "green";
}

function ga4VerificationBadgeLabel(input: {
  loading: boolean;
  mapping: WorkspaceGa4MetricSourceMapping | null;
  fallbackLabel: string;
}): string {
  if (input.loading) {
    return "Loading";
  }

  if (!input.mapping?.enabled) {
    return input.fallbackLabel;
  }

  if (input.mapping.verificationStatus === "verified") {
    return "Verified";
  }

  if (input.mapping.verificationStatus === "needs_reconnect") {
    return "Needs reconnect";
  }

  if (input.mapping.verificationStatus === "property_inaccessible") {
    return "Property inaccessible";
  }

  if (input.mapping.verificationStatus === "error") {
    return "Verification error";
  }

  return "Property mapped";
}

function ga4VerificationStatusCopy(mapping: WorkspaceGa4MetricSourceMapping | null): string | null {
  if (!mapping?.enabled) {
    return null;
  }

  if (mapping.verificationStatus === "verified") {
    return `Last verified: ${displayDate(mapping.lastVerifiedAt ?? undefined)}`;
  }

  if (mapping.verificationStatus === "needs_reconnect") {
    return "Google connection needs reconnect.";
  }

  if (mapping.verificationStatus === "property_inaccessible") {
    return "The selected GA4 property is no longer accessible from this Google account.";
  }

  if (mapping.verificationStatus === "error") {
    const code = mapping.lastVerificationCode ? ` (${mapping.lastVerificationCode})` : "";
    return `${mapping.lastVerificationError || "GA4 source verification failed."}${code}`;
  }

  return "Not verified yet";
}

function EmptyCopy({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm font-medium text-slate-500">{children}</div>;
}

function SectionCard({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="rounded-lg border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-950 text-white shadow-sm">{icon}</div>
          <CardTitle>{title}</CardTitle>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function firstUserMessage(session: CMOChatSession): string {
  return session.messages.find((message) => message.role === "user")?.content ?? "";
}

function latestAssistantMessage(session: CMOChatSession): string {
  return [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
}

function isSmokeSession(session: CMOChatSession | undefined): boolean {
  if (!session) {
    return false;
  }

  const text = `${session.topic} ${firstUserMessage(session)}`.toLowerCase();

  return /\bsmoke\b|ui test|ui qa|verification|runtime smoke|app-turn smoke|\bphase\s+\d/i.test(text);
}

type SessionFilter = "all" | "live";
type PlanReviewTypeFilter = "all" | "decisions" | "tasks" | "memory";
type PlanReviewStatusFilter = "pending" | "approved" | "skipped";
type AggregatorChartMode = "transactions" | "volume";
type PartnerChartMode = "daily_volume" | "volume_share" | "daily_transactions" | "transaction_share";

type DuneAggregatorPoint = {
  date: string;
  countTx: number;
  cumulativeTxCount: number;
  dailyVolume: number;
  cumulativeVolume: number;
  feeAmount: number;
};

type DunePartnerPoint = {
  date: string;
  partnerCode: string;
  volume: number;
  countTx: number;
};

type DunePartnerSummaryRow = {
  partnerCode: string;
  totalVolume: number;
  totalTransactions: number;
};

type LensOAuthSafeAccount = {
  id: string;
  tenantId: string;
  provider: "google";
  googleEmail: string | null;
  scopes: string[];
  status: "connected" | "revoked" | "error";
  createdAt: string;
  updatedAt: string;
  lastRefreshAt?: string | null;
  lastError?: string | null;
};

type LensOAuthAccountsResponse = {
  data: LensOAuthSafeAccount[];
  oauthConfigured: boolean;
  missingConfig: string[];
};

type LensGa4Property = {
  propertyId: string;
  propertyName?: string;
  displayName: string;
  accountId?: string;
  accountName?: string;
  timezone?: string | null;
};

type LensGa4PropertiesResponse = {
  data: {
    properties: LensGa4Property[];
  };
};

type WorkspaceGa4MetricSourceMapping = {
  sourceType: "ga4";
  provider: "ga4_native";
  oauthAccountId: string | null;
  propertyId: string;
  propertyDisplayName?: string;
  accountId?: string;
  accountDisplayName?: string;
  timezone?: string | null;
  enabled: boolean;
  verificationStatus?: WorkspaceGa4VerificationStatus;
  lastVerifiedAt?: string | null;
  lastVerificationError?: string | null;
  lastVerificationCode?: string | null;
};

type WorkspaceGa4MetricSourceResponse = {
  data: WorkspaceGa4MetricSourceMapping | null;
};

type WorkspaceGa4VerificationStatus = "verified" | "needs_reconnect" | "property_inaccessible" | "error";

type WorkspaceGa4VerificationResponse = {
  mapping: WorkspaceGa4MetricSourceMapping | null;
  verification: {
    ok: boolean;
    status: WorkspaceGa4VerificationStatus;
    code?: string;
    message?: string;
  };
};

type WorkspaceGa4MetricSnapshot = {
  sourceType: "ga4";
  sourceId: "ga4_native";
  rangeKey: "this_week" | "last_7_days" | "last_30_days" | "this_month";
  dateStart: string;
  dateEnd: string;
  timezone: string | null;
  status: "synced" | "error";
  syncedAt: string | null;
  lastError?: string | null;
  metrics: {
    activeUsers?: number | null;
    newUsers?: number | null;
    totalUsers?: number | null;
    sessions?: number | null;
    engagedSessions?: number | null;
    engagementRate?: number | null;
    eventCount?: number | null;
    userEngagementDuration?: number | null;
  };
};

type WorkspaceGa4MetricSnapshotResponse = {
  data: WorkspaceGa4MetricSnapshot | null;
};

type WorkspaceGa4DashboardRangeKey = Exclude<CmoAppMetricDateRangePreset, "custom">;

type ProductMetricDefinitionType = "activation" | "retention";
type ProductMetricDefinitionStatus =
  | "computed"
  | "definition_needed"
  | "configured_but_unavailable"
  | "not_matured"
  | "no_data"
  | "no_denominator"
  | "failed";

type ProductMetricDefinition = {
  definition_type: ProductMetricDefinitionType;
  enabled: boolean;
  definition: Record<string, unknown>;
  updated_at?: string | null;
};

type ProductMetricDefinitionsResponse = {
  schema_version: "product.metric_definitions.v1";
  status: "saved" | "completed" | "failed";
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  definitions: ProductMetricDefinition[];
  safety: {
    no_tokens_returned: true;
    raw_ga4_response_included: false;
    vault_write_performed: false;
    gbrain_used: false;
    hermes_called: false;
  };
};

type ProductMetricDefinitionSnapshot = {
  definition_type: ProductMetricDefinitionType;
  range_key: "yesterday" | "this_week" | "last_7_days" | "last_30_days";
  date_start: string;
  date_end: string;
  timezone: string | null;
  status: ProductMetricDefinitionStatus;
  metrics: Record<string, unknown>;
  definition: Record<string, unknown>;
  evidence: Record<string, unknown>;
  quality: Record<string, unknown>;
  generated_at: string | null;
};

type ProductMetricDefinitionSnapshotsResponse = {
  schema_version: "product.metric_definition_snapshots.v1";
  status: "completed" | "missing" | "partial";
  tenant_id: string;
  workspace_id: string;
  app_id: string;
  range_key: "yesterday" | "this_week" | "last_7_days" | "last_30_days";
  snapshots: ProductMetricDefinitionSnapshot[];
};

type ProductMetricDefinitionComputeResponse = {
  schema_version: "product.metric_definition_compute_result.v1";
  status: "completed" | "partial" | "failed";
};

const dateRangeOptions: Array<{ id: CmoAppMetricDateRangePreset; label: string }> = [
  { id: "this_week", label: "This week" },
  { id: "last_7_days", label: "Last 7 days" },
  { id: "last_30_days", label: "Last 30 days" },
  { id: "this_month", label: "This month" },
  { id: "custom", label: "Custom" },
];

const planTypeOptions: Array<{ id: PlanReviewTypeFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "decisions", label: "Decisions" },
  { id: "tasks", label: "Tasks" },
  { id: "memory", label: "Memory" },
];

const planStatusOptions: Array<{ id: PlanReviewStatusFilter; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "skipped", label: "Skipped" },
];

function contextStatusLabel(summary: { existingCount: number; selectedCount: number; missingCount: number }): "Ready" | "Partial" | "Missing" {
  if (summary.selectedCount === 0 || summary.existingCount === 0) {
    return "Missing";
  }

  return summary.missingCount > 0 ? "Partial" : "Ready";
}

function contextStatusVariant(status: "Ready" | "Partial" | "Missing"): "green" | "orange" | "red" {
  if (status === "Ready") {
    return "green";
  }

  return status === "Partial" ? "orange" : "red";
}

function FieldValue({ label, value }: { label: string; value?: React.ReactNode }) {
  const displayValue = value === null || value === undefined || value === "" ? "Not set" : value;

  return (
    <div className="rounded-lg border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-bold uppercase text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-bold text-slate-950">{displayValue}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
  muted,
  status,
  comparison,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  muted?: boolean;
  status?: React.ReactNode;
  comparison?: React.ReactNode;
}) {
  return (
    <div className="min-h-28 rounded-lg border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-bold uppercase text-slate-400">{label}</div>
        {status}
      </div>
      <div className={cn("mt-3 text-2xl font-bold tracking-tight", muted ? "text-slate-400" : "text-slate-950")}>{value}</div>
      {detail ? <div className="mt-2 text-xs font-semibold leading-5 text-slate-500">{detail}</div> : null}
      {comparison ? <div className="mt-2 text-xs font-semibold leading-5 text-slate-500">{comparison}</div> : null}
    </div>
  );
}

function metricStatusLabel(status: CmoAppMetric["status"] | CmoAppMetricsSnapshot["status"] | undefined): string {
  if (status === "connected") {
    return "Connected";
  }

  if (status === "partial") {
    return "Partial";
  }

  if (status === "placeholder") {
    return "Placeholder";
  }

  return "Missing";
}

function metricStatusVariant(status: CmoAppMetric["status"] | CmoAppMetricsSnapshot["status"] | undefined): "green" | "orange" | "red" | "slate" {
  if (status === "connected") {
    return "green";
  }

  if (status === "partial" || status === "placeholder") {
    return "orange";
  }

  return status === "missing" ? "red" : "slate";
}

function channelMetricStatusLabel(status: CmoChannelMetric["status"] | CmoChannelMetricsSnapshot["status"] | undefined): string {
  if (status === "connected") {
    return "Connected";
  }

  if (status === "partial") {
    return "Partial";
  }

  if (status === "placeholder") {
    return "Placeholder";
  }

  return "Missing";
}

function channelMetricStatusVariant(status: CmoChannelMetric["status"] | CmoChannelMetricsSnapshot["status"] | undefined): "green" | "orange" | "red" | "slate" {
  if (status === "connected") {
    return "green";
  }

  if (status === "partial" || status === "placeholder") {
    return "orange";
  }

  return status === "missing" ? "red" : "slate";
}

function channelSourceLabel(source: CmoChannelMetricsSnapshot["source"] | undefined): string {
  if (source === "facebook_native") {
    return "Facebook Native";
  }

  if (source === "lens.facebook_page") {
    return "Lens Facebook";
  }

  if (source === "placeholder") {
    return "Placeholder";
  }

  return "Not connected";
}

function channelSyncStatusLabel(status: CmoChannelMetricsSyncStatus["status"] | undefined): string {
  if (status === "success") {
    return "Success";
  }

  if (status === "partial") {
    return "Partial";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Not scheduled";
}

function channelSyncStatusVariant(status: CmoChannelMetricsSyncStatus["status"] | undefined): "green" | "orange" | "red" | "slate" {
  if (status === "success") {
    return "green";
  }

  if (status === "partial") {
    return "orange";
  }

  if (status === "failed") {
    return "red";
  }

  return "slate";
}

function channelSyncStatusCopy(status: CmoChannelMetricsSyncStatus | null): string {
  if (status?.status === "failed") {
    return "Showing last successful Lens snapshot.";
  }

  if (status?.status === "skipped" || !status) {
    return "Manual refresh only.";
  }

  return "Lens sync tracked.";
}

function channelStatusCopy(status: CmoChannelMetricsSnapshot["status"] | undefined): string {
  if (status === "connected") {
    return "Facebook channel metrics connected.";
  }

  if (status === "partial") {
    return "Some Facebook channel metrics are available. Link clicks and CTR are not connected yet.";
  }

  return "Facebook channel data not normalized yet.";
}

function channelMetricDisplayValue(metric: CmoChannelMetric | undefined): string {
  if (!metric || metric.value === null || metric.value === undefined) {
    return "No data";
  }

  if (metric.displayValue && metric.displayValue !== "No data") {
    return metric.displayValue;
  }

  if (metric.unit === "percent") {
    return `${Number(metric.value.toFixed(2)).toLocaleString("en-US")}%`;
  }

  return new Intl.NumberFormat("en-US").format(metric.value);
}

function channelMetricHasData(metric: CmoChannelMetric | undefined): boolean {
  return typeof metric?.value === "number" && Number.isFinite(metric.value);
}

function channelMetricBadgeLabel(metric: CmoChannelMetric | undefined): string {
  return channelMetricHasData(metric) ? channelMetricStatusLabel(metric?.status) : "No data";
}

function channelMetricBadgeVariant(metric: CmoChannelMetric | undefined): "green" | "orange" | "slate" {
  if (!channelMetricHasData(metric)) {
    return "slate";
  }

  return metric?.status === "partial" ? "orange" : "green";
}

function businessMetricStatusLabel(status: CmoBusinessMetric["status"] | CmoBusinessMetricsSnapshot["status"] | undefined): string {
  if (status === "connected") {
    return "Connected";
  }

  if (status === "partial") {
    return "Partial";
  }

  if (status === "placeholder") {
    return "Placeholder";
  }

  return "Missing";
}

function businessMetricStatusVariant(status: CmoBusinessMetric["status"] | CmoBusinessMetricsSnapshot["status"] | undefined): "green" | "orange" | "red" | "slate" {
  if (status === "connected") {
    return "green";
  }

  if (status === "partial" || status === "placeholder") {
    return "orange";
  }

  return status === "missing" ? "red" : "slate";
}

function businessMetricDisplayValue(metric: CmoBusinessMetric | undefined): string {
  if (!metric || !businessMetricHasData(metric)) {
    return "No data";
  }

  if (metric.displayValue && metric.displayValue !== "No data") {
    return metric.displayValue;
  }

  if (metric.textValue) {
    return metric.textValue;
  }

  if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) {
    return "No data";
  }

  if (metric.unit === "percent") {
    return `${Number(metric.value.toFixed(2)).toLocaleString("en-US")}%`;
  }

  if (metric.unit === "usd") {
    return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(metric.value)}`;
  }

  return new Intl.NumberFormat("en-US").format(metric.value);
}

function businessMetricHasData(metric: CmoBusinessMetric | undefined): boolean {
  return (typeof metric?.value === "number" && Number.isFinite(metric.value)) || Boolean(metric?.textValue) || Boolean(metric?.displayValue && metric.displayValue !== "No data");
}

function businessMetricBadgeLabel(metric: CmoBusinessMetric | undefined): string {
  return businessMetricHasData(metric) ? businessMetricStatusLabel(metric?.status) : "No data";
}

function businessMetricBadgeVariant(metric: CmoBusinessMetric | undefined): "green" | "orange" | "slate" {
  if (!businessMetricHasData(metric)) {
    return "slate";
  }

  return metric?.status === "partial" ? "orange" : "green";
}

function businessSnapshotHasData(snapshot: CmoBusinessMetricsSnapshot | null): boolean {
  return Boolean(snapshot?.metrics.some((metric) => businessMetricHasData(metric)));
}

function businessCombinedStatus(snapshots: Array<CmoBusinessMetricsSnapshot | null>, loadStatus: "idle" | "loading" | "ready" | "error"): CmoBusinessMetricsSnapshot["status"] | undefined {
  if (loadStatus === "loading") {
    return undefined;
  }

  const available = snapshots.filter((snapshot): snapshot is CmoBusinessMetricsSnapshot => Boolean(snapshot));

  if (!available.length || available.every((snapshot) => !businessSnapshotHasData(snapshot))) {
    return "missing";
  }

  return available.every((snapshot) => snapshot.status === "connected") ? "connected" : "partial";
}

function businessLatestTimestamp(snapshots: Array<CmoBusinessMetricsSnapshot | null>): string | null {
  const timestamps = snapshots
    .flatMap((snapshot) => snapshot && businessSnapshotHasData(snapshot) ? [snapshot.lastUpdatedAt, snapshot.source.fetchedAt] : [])
    .filter((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left));

  return timestamps[0] ?? null;
}

const DUNE_CHART_COLORS = ["#2563eb", "#0f766e", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#65a30d", "#be185d", "#64748b"];

function recordNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function recordString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function compactCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function compactUsd(value: number): string {
  return `$${new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 10_000 ? 1 : 0,
  }).format(value)}`;
}

function shortDateLabel(value: string): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

function seriesRecords(snapshot: CmoBusinessMetricsSnapshot | null, id: string): Array<Record<string, unknown>> {
  return snapshot?.series?.find((series) => series.id === id)?.points ?? [];
}

function tableRecords(snapshot: CmoBusinessMetricsSnapshot | null, id: string): Array<Record<string, unknown>> {
  return snapshot?.tables?.find((table) => table.id === id)?.rows ?? [];
}

function duneAggregatorPoints(snapshot: CmoBusinessMetricsSnapshot | null): DuneAggregatorPoint[] {
  return seriesRecords(snapshot, "wld_aggregator_daily_series")
    .map((record) => ({
      date: recordString(record, "evt_block_date"),
      countTx: recordNumber(record, "count_tx"),
      cumulativeTxCount: recordNumber(record, "cumulative_tx_count"),
      dailyVolume: recordNumber(record, "daily_volume"),
      cumulativeVolume: recordNumber(record, "cumulative_volume"),
      feeAmount: recordNumber(record, "fee_amount"),
    }))
    .filter((point) => point.date)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function dunePartnerPoints(snapshot: CmoBusinessMetricsSnapshot | null): DunePartnerPoint[] {
  return seriesRecords(snapshot, "wld_partner_daily_series")
    .map((record) => ({
      date: recordString(record, "evt_block_date"),
      partnerCode: recordString(record, "partnerCode") || "Unknown",
      volume: recordNumber(record, "volume"),
      countTx: recordNumber(record, "count_tx"),
    }))
    .filter((point) => point.date)
    .sort((left, right) => left.date.localeCompare(right.date) || left.partnerCode.localeCompare(right.partnerCode));
}

function dunePartnerSummaryRows(snapshot: CmoBusinessMetricsSnapshot | null): DunePartnerSummaryRow[] {
  return tableRecords(snapshot, "wld_partner_summary")
    .map((record) => ({
      partnerCode: recordString(record, "partnerCode") || "Unknown",
      totalVolume: recordNumber(record, "total_volume"),
      totalTransactions: recordNumber(record, "total_transactions"),
    }))
    .filter((row) => row.totalVolume > 0 || row.totalTransactions > 0)
    .sort((left, right) => right.totalVolume - left.totalVolume);
}

function topNPlusOther(rows: DunePartnerSummaryRow[], valueFor: (row: DunePartnerSummaryRow) => number, limit = 8): DunePartnerSummaryRow[] {
  const sorted = [...rows].sort((left, right) => valueFor(right) - valueFor(left));
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);

  if (!rest.length) {
    return top;
  }

  const other = rest.reduce(
    (acc, row) => ({
      partnerCode: "Other",
      totalVolume: acc.totalVolume + row.totalVolume,
      totalTransactions: acc.totalTransactions + row.totalTransactions,
    }),
    { partnerCode: "Other", totalVolume: 0, totalTransactions: 0 },
  );

  return [...top, other];
}

function partnerCodesByTotal(points: DunePartnerPoint[], field: "volume" | "countTx", limit = 8): string[] {
  const totals = new Map<string, number>();

  points.forEach((point) => {
    totals.set(point.partnerCode, (totals.get(point.partnerCode) ?? 0) + point[field]);
  });

  const sorted = [...totals.entries()]
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([partner]) => partner);

  return sorted.length > limit ? [...sorted.slice(0, limit), "Other"] : sorted;
}

function partnerDailyRows(points: DunePartnerPoint[], field: "volume" | "countTx", partners: string[]): Array<{ date: string; values: Record<string, number>; total: number }> {
  const topPartners = partners.filter((partner) => partner !== "Other");
  const byDate = new Map<string, Record<string, number>>();

  points.forEach((point) => {
    const bucket = topPartners.includes(point.partnerCode) ? point.partnerCode : "Other";
    const values = byDate.get(point.date) ?? {};

    values[bucket] = (values[bucket] ?? 0) + point[field];
    byDate.set(point.date, values);
  });

  return [...byDate.entries()]
    .map(([date, values]) => ({
      date,
      values,
      total: partners.reduce((sum, partner) => sum + (values[partner] ?? 0), 0),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-sm font-semibold text-slate-400">
      {message}
    </div>
  );
}

function ChartTabs({
  options,
  active,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-md border px-2.5 py-1.5 text-xs font-bold transition",
            active === option.id
              ? "border-slate-950 bg-slate-950 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function AggregatorComboChart({ snapshot, mode }: { snapshot: CmoBusinessMetricsSnapshot | null; mode: AggregatorChartMode }) {
  const points = duneAggregatorPoints(snapshot);

  if (!points.length) {
    return <EmptyChart message="No Dune aggregator series connected yet." />;
  }

  const width = 720;
  const height = 260;
  const left = 46;
  const right = 24;
  const top = 20;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const barField = mode === "transactions" ? "countTx" : "dailyVolume";
  const lineField = mode === "transactions" ? "cumulativeTxCount" : "cumulativeVolume";
  const barLabel = mode === "transactions" ? "count_tx" : "daily_volume";
  const lineLabel = mode === "transactions" ? "cumulative_tx_count" : "cumulative_volume";
  const format = mode === "transactions" ? compactCount : compactUsd;
  const barMax = Math.max(...points.map((point) => point[barField]), 1);
  const lineMax = Math.max(...points.map((point) => point[lineField]), 1);
  const xFor = (index: number) => left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const barWidth = Math.max(8, Math.min(26, plotWidth / Math.max(points.length, 1) * 0.5));
  const yForBar = (value: number) => top + plotHeight - (value / barMax) * plotHeight;
  const yForLine = (value: number) => top + plotHeight - (value / lineMax) * plotHeight;
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yForLine(point[lineField])}`).join(" ");
  const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-100 bg-white">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={mode === "transactions" ? "Count Daily Transaction chart" : "Daily Volume in USD chart"} className="h-64 w-full">
        <rect x="0" y="0" width={width} height={height} fill="white" />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={top + plotHeight * tick} y2={top + plotHeight * tick} stroke="#e2e8f0" strokeDasharray={tick === 1 ? "0" : "4 5"} />
          </g>
        ))}
        {points.map((point, index) => {
          const x = xFor(index);
          const y = yForBar(point[barField]);
          const barHeight = top + plotHeight - y;

          return (
            <g key={`${point.date}-${index}`}>
              <title>{`${point.date}\n${barLabel}: ${format(point[barField])}\n${lineLabel}: ${format(point[lineField])}`}</title>
              <rect x={x - barWidth / 2} y={y} width={barWidth} height={barHeight} rx="4" fill="#2563eb" opacity="0.76" />
              {labelIndexes.has(index) ? <text x={x} y={height - 12} textAnchor="middle" className="fill-slate-400 text-[11px] font-semibold">{shortDateLabel(point.date)}</text> : null}
            </g>
          );
        })}
        <path d={linePath} fill="none" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <circle key={`${point.date}-line`} cx={xFor(index)} cy={yForLine(point[lineField])} r="4" fill="#f59e0b" stroke="white" strokeWidth="2">
            <title>{`${point.date}\n${barLabel}: ${format(point[barField])}\n${lineLabel}: ${format(point[lineField])}`}</title>
          </circle>
        ))}
        <text x={left} y="18" className="fill-slate-500 text-[11px] font-bold">{mode === "transactions" ? "Bar: daily tx" : "Bar: daily volume"}</text>
        <text x={width - right} y="18" textAnchor="end" className="fill-slate-500 text-[11px] font-bold">{mode === "transactions" ? "Line: cumulative tx" : "Line: cumulative volume"}</text>
        <text x={left} y={top + 8} className="fill-slate-400 text-[10px] font-semibold">{format(barMax)}</text>
        <text x={width - right} y={top + 8} textAnchor="end" className="fill-slate-400 text-[10px] font-semibold">{format(lineMax)}</text>
      </svg>
    </div>
  );
}

function PartnerStackedBarChart({
  snapshot,
  field,
}: {
  snapshot: CmoBusinessMetricsSnapshot | null;
  field: "volume" | "countTx";
}) {
  const points = dunePartnerPoints(snapshot);
  const partners = partnerCodesByTotal(points, field);
  const rows = partnerDailyRows(points, field, partners);

  if (!rows.length || !partners.length) {
    return <EmptyChart message="No Dune partner daily series connected yet." />;
  }

  const width = 720;
  const height = 260;
  const left = 46;
  const right = 22;
  const top = 20;
  const bottom = 44;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxTotal = Math.max(...rows.map((row) => row.total), 1);
  const format = field === "volume" ? compactUsd : compactCount;
  const xFor = (index: number) => left + (rows.length === 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const barWidth = Math.max(10, Math.min(30, plotWidth / Math.max(rows.length, 1) * 0.52));
  const labelIndexes = new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-100 bg-white">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={field === "volume" ? "Daily Partner Volume chart" : "Daily Partner Transaction Count chart"} className="h-64 w-full">
        <rect x="0" y="0" width={width} height={height} fill="white" />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <line key={tick} x1={left} x2={width - right} y1={top + plotHeight * tick} y2={top + plotHeight * tick} stroke="#e2e8f0" strokeDasharray={tick === 1 ? "0" : "4 5"} />
        ))}
        {rows.map((row, rowIndex) => {
          const x = xFor(rowIndex);
          let running = 0;

          return (
            <g key={row.date}>
              {partners.map((partner, partnerIndex) => {
                const value = row.values[partner] ?? 0;
                const y = top + plotHeight - ((running + value) / maxTotal) * plotHeight;
                const segmentHeight = (value / maxTotal) * plotHeight;
                running += value;

                if (value <= 0) {
                  return null;
                }

                return (
                  <rect key={partner} x={x - barWidth / 2} y={y} width={barWidth} height={segmentHeight} fill={DUNE_CHART_COLORS[partnerIndex % DUNE_CHART_COLORS.length]}>
                    <title>{`${row.date}\n${partner}: ${format(value)}\nTotal: ${format(row.total)}`}</title>
                  </rect>
                );
              })}
              {labelIndexes.has(rowIndex) ? <text x={x} y={height - 18} textAnchor="middle" className="fill-slate-400 text-[11px] font-semibold">{shortDateLabel(row.date)}</text> : null}
            </g>
          );
        })}
        <text x={left} y="18" className="fill-slate-500 text-[11px] font-bold">{field === "volume" ? "Stacked daily volume" : "Stacked daily tx"}</text>
        <text x={left} y={top + 8} className="fill-slate-400 text-[10px] font-semibold">{format(maxTotal)}</text>
      </svg>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 py-2">
        {partners.map((partner, index) => (
          <span key={partner} className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: DUNE_CHART_COLORS[index % DUNE_CHART_COLORS.length] }} />
            {partner}
          </span>
        ))}
      </div>
    </div>
  );
}

function PartnerDonutChart({
  snapshot,
  field,
}: {
  snapshot: CmoBusinessMetricsSnapshot | null;
  field: "totalVolume" | "totalTransactions";
}) {
  const rows = topNPlusOther(dunePartnerSummaryRows(snapshot), (row) => row[field], 8).filter((row) => row[field] > 0);

  if (!rows.length) {
    return <EmptyChart message="No Dune partner summary table connected yet." />;
  }

  const total = rows.reduce((sum, row) => sum + row[field], 0);
  const format = field === "totalVolume" ? compactUsd : compactCount;
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  const segments = rows.reduce<Array<{ row: DunePartnerSummaryRow; dash: number; offset: number }>>((acc, row) => {
    const previousOffset = acc.reduce((sum, segment) => sum + segment.dash, 0);
    const dash = total > 0 ? row[field] / total * circumference : 0;

    return [...acc, { row, dash, offset: previousOffset }];
  }, []);

  return (
    <div className="grid gap-3 rounded-lg border border-slate-100 bg-white p-3 md:grid-cols-[200px_1fr]">
      <svg viewBox="0 0 220 220" role="img" aria-label={field === "totalVolume" ? "Partner Volume donut chart" : "Partner Transaction Count donut chart"} className="mx-auto h-52 w-52">
        <circle cx="110" cy="110" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="28" />
        {segments.map(({ row, dash, offset }, index) => {
          const value = row[field];

          return (
            <circle
              key={row.partnerCode}
              cx="110"
              cy="110"
              r={radius}
              fill="none"
              stroke={DUNE_CHART_COLORS[index % DUNE_CHART_COLORS.length]}
              strokeWidth="28"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 110 110)"
            >
              <title>{`${row.partnerCode}: ${format(value)} (${total > 0 ? Number((value / total * 100).toFixed(1)) : 0}%)`}</title>
            </circle>
          );
        })}
        <text x="110" y="106" textAnchor="middle" className="fill-slate-950 text-[20px] font-bold">{format(total)}</text>
        <text x="110" y="128" textAnchor="middle" className="fill-slate-400 text-[11px] font-bold uppercase">total</text>
      </svg>
      <div className="grid content-center gap-2">
        {rows.map((row, index) => {
          const value = row[field];
          const share = total > 0 ? value / total * 100 : 0;

          return (
            <div key={row.partnerCode} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: DUNE_CHART_COLORS[index % DUNE_CHART_COLORS.length] }} />
                <span className="truncate text-xs font-bold text-slate-600">{row.partnerCode}</span>
              </div>
              <div className="text-right text-xs font-bold text-slate-950">{format(value)} <span className="text-slate-400">{Number(share.toFixed(1))}%</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DuneBusinessCharts({
  aggregatorSnapshot,
  partnerSnapshot,
  aggregatorMode,
  partnerMode,
  onAggregatorModeChange,
  onPartnerModeChange,
}: {
  aggregatorSnapshot: CmoBusinessMetricsSnapshot | null;
  partnerSnapshot: CmoBusinessMetricsSnapshot | null;
  aggregatorMode: AggregatorChartMode;
  partnerMode: PartnerChartMode;
  onAggregatorModeChange: (mode: AggregatorChartMode) => void;
  onPartnerModeChange: (mode: PartnerChartMode) => void;
}) {
  return (
    <div className="mt-4 grid gap-3">
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-950">WLD Aggregator Charts</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">Bars show daily values. Lines show cumulative values from the stored Dune series.</div>
          </div>
          <ChartTabs
            active={aggregatorMode}
            onChange={(value) => onAggregatorModeChange(value as AggregatorChartMode)}
            options={[
              { id: "transactions", label: "Count Daily Transaction" },
              { id: "volume", label: "Daily Volume in USD" },
            ]}
          />
        </div>
        <AggregatorComboChart snapshot={aggregatorSnapshot} mode={aggregatorMode} />
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-950">Partner Stats Charts</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">Top 8 partners are shown individually; the rest are grouped into Other.</div>
          </div>
          <ChartTabs
            active={partnerMode}
            onChange={(value) => onPartnerModeChange(value as PartnerChartMode)}
            options={[
              { id: "daily_volume", label: "Daily Partner Volume" },
              { id: "volume_share", label: "Partner Volume" },
              { id: "daily_transactions", label: "Daily Partner Transaction Count" },
              { id: "transaction_share", label: "Partner Transaction Count" },
            ]}
          />
        </div>
        {partnerMode === "daily_volume" ? <PartnerStackedBarChart snapshot={partnerSnapshot} field="volume" /> : null}
        {partnerMode === "volume_share" ? <PartnerDonutChart snapshot={partnerSnapshot} field="totalVolume" /> : null}
        {partnerMode === "daily_transactions" ? <PartnerStackedBarChart snapshot={partnerSnapshot} field="countTx" /> : null}
        {partnerMode === "transaction_share" ? <PartnerDonutChart snapshot={partnerSnapshot} field="totalTransactions" /> : null}
      </div>
    </div>
  );
}

function ChannelMetricTile({
  metric,
  label,
  size = "normal",
}: {
  metric?: CmoChannelMetric;
  label?: string;
  size?: "primary" | "normal" | "compact";
}) {
  const hasData = channelMetricHasData(metric);
  const valueClass = size === "primary" ? "text-2xl" : size === "compact" ? "text-base" : "text-xl";

  return (
    <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-bold uppercase text-slate-400">{label ?? metric?.label ?? "Metric"}</div>
        <Badge variant={channelMetricBadgeVariant(metric)}>{channelMetricBadgeLabel(metric)}</Badge>
      </div>
      <div className={cn("mt-3 font-bold tracking-tight", hasData ? "text-slate-950" : "text-slate-400", valueClass)}>{channelMetricDisplayValue(metric)}</div>
      {metric?.caveat && size !== "compact" ? <div className="mt-2 text-xs font-semibold leading-5 text-slate-500">{metric.caveat}</div> : null}
    </div>
  );
}

function BusinessMetricTile({
  metric,
  label,
}: {
  metric?: CmoBusinessMetric;
  label?: string;
}) {
  const hasData = businessMetricHasData(metric);

  return (
    <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-bold uppercase text-slate-400">{label ?? metric?.label ?? "Metric"}</div>
        <Badge variant={businessMetricBadgeVariant(metric)}>{businessMetricBadgeLabel(metric)}</Badge>
      </div>
      <div className={cn("mt-3 text-xl font-bold tracking-tight", hasData ? "text-slate-950" : "text-slate-400")}>{businessMetricDisplayValue(metric)}</div>
    </div>
  );
}

function sessionOutputCount(session: CMOChatSession): number {
  return session.decisionLayer
    ? session.decisionLayer.decisions.length +
        session.decisionLayer.assumptions.length +
        session.decisionLayer.suggestedActions.length +
        session.decisionLayer.memoryCandidates.length +
        session.decisionLayer.taskCandidates.length
    : 0;
}

function sessionGroupLabel(createdAt: string): string {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return "Earlier";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfSessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.floor((startOfToday - startOfSessionDay) / 86400000);

  if (dayDiff <= 0) {
    return "Today";
  }

  if (dayDiff === 1) {
    return "Yesterday";
  }

  return "Earlier";
}

function matchesSessionFilter(session: CMOChatSession, filter: SessionFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "live") {
    return session.runtimeMode === "live" || session.runtimeStatus === "live";
  }

  return true;
}

export function AppWorkspaceView({ state }: { state: AppWorkspaceState }) {
  const { app } = state;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<AppWorkspaceTab>(workspaceTabFromParam(tabParam));
  const [contextBrief, setContextBrief] = useState(state.contextBrief);
  const [priorityState, setPriorityState] = useState(state.priorityState);
  const [plans, setPlans] = useState<AppWorkspacePlanState>(state.plans);
  const [planStatus, setPlanStatus] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CMOChatSession[]>(state.latestSessions);
  const [latestPromotion, setLatestPromotion] = useState(state.latestPromotion);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(state.latestSessions.find((session) => !isSmokeSession(session))?.id ?? state.latestSessions[0]?.id ?? null);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [dateRange, setDateRange] = useState<CmoAppMetricDateRangePreset>("this_week");
  const [comparePrevious, setComparePrevious] = useState(false);
  const showChannelPerformance = app.id === "holdstation-mini-app";
  const showBusinessMetrics = app.id === "holdstation-mini-app";
  const [metricsSnapshot, setMetricsSnapshot] = useState<CmoAppMetricsSnapshot | null>(null);
  const [metricsStatus, setMetricsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [channelMetricsSnapshot, setChannelMetricsSnapshot] = useState<CmoChannelMetricsSnapshot | null>(null);
  const [channelMetricsStatus, setChannelMetricsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [channelMetricsError, setChannelMetricsError] = useState<string | null>(null);
  const [channelSyncStatus, setChannelSyncStatus] = useState<CmoChannelMetricsSyncStatus | null>(null);
  const [channelSyncLoadStatus, setChannelSyncLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [dexBusinessMetricsSnapshot, setDexBusinessMetricsSnapshot] = useState<CmoBusinessMetricsSnapshot | null>(null);
  const [feesBusinessMetricsSnapshot, setFeesBusinessMetricsSnapshot] = useState<CmoBusinessMetricsSnapshot | null>(null);
  const [businessMetricsStatus, setBusinessMetricsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [businessMetricsError, setBusinessMetricsError] = useState<string | null>(null);
  const [lensOAuthAccounts, setLensOAuthAccounts] = useState<LensOAuthSafeAccount[]>([]);
  const [lensOAuthConfigured, setLensOAuthConfigured] = useState<boolean | null>(null);
  const [lensOAuthMissingConfig, setLensOAuthMissingConfig] = useState<string[]>([]);
  const [lensOAuthStatus, setLensOAuthStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [lensOAuthError, setLensOAuthError] = useState<string | null>(null);
  const [ga4Properties, setGa4Properties] = useState<LensGa4Property[]>([]);
  const [ga4PropertiesStatus, setGa4PropertiesStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [ga4PropertiesError, setGa4PropertiesError] = useState<string | null>(null);
  const [selectedGa4PropertyId, setSelectedGa4PropertyId] = useState("");
  const [ga4MetricSourceMapping, setGa4MetricSourceMapping] = useState<WorkspaceGa4MetricSourceMapping | null>(null);
  const [ga4MetricSnapshot, setGa4MetricSnapshot] = useState<WorkspaceGa4MetricSnapshot | null>(null);
  const [ga4SnapshotStatus, setGa4SnapshotStatus] = useState<"idle" | "loading" | "ready" | "syncing" | "error">("idle");
  const [ga4SnapshotError, setGa4SnapshotError] = useState<string | null>(null);
  const [ga4MappingStatus, setGa4MappingStatus] = useState<"idle" | "loading" | "ready" | "saving" | "verifying" | "error">("idle");
  const [ga4MappingError, setGa4MappingError] = useState<string | null>(null);
  const [metricDefinitions, setMetricDefinitions] = useState<ProductMetricDefinition[]>([]);
  const [metricDefinitionSnapshots, setMetricDefinitionSnapshots] = useState<ProductMetricDefinitionSnapshot[]>([]);
  const [metricDefinitionsStatus, setMetricDefinitionsStatus] = useState<"idle" | "loading" | "ready" | "saving" | "computing" | "error">("idle");
  const [metricDefinitionsError, setMetricDefinitionsError] = useState<string | null>(null);
  const [activationEventsInput, setActivationEventsInput] = useState("");
  const [activationDenominator, setActivationDenominator] = useState<"active_users" | "new_users" | "total_users">("active_users");
  const [retentionEventsInput, setRetentionEventsInput] = useState("");
  const [aggregatorChartMode, setAggregatorChartMode] = useState<AggregatorChartMode>("transactions");
  const [partnerChartMode, setPartnerChartMode] = useState<PartnerChartMode>("daily_volume");
  const [planTypeFilter, setPlanTypeFilter] = useState<PlanReviewTypeFilter>("all");
  const [planStatusFilter, setPlanStatusFilter] = useState<PlanReviewStatusFilter>("pending");
  const [sessionFocusSignal, setSessionFocusSignal] = useState(0);
  const [memoryRefreshSignal, setMemoryRefreshSignal] = useState(0);
  const [promotionRefreshSignal, setPromotionRefreshSignal] = useState(0);
  const selectedQuality = contextBrief.contextQualitySummary;
  const selectedSession = selectedSessionId ? sessions.find((session) => session.id === selectedSessionId) : undefined;
  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();

    return sessions.filter((session) => {
      const searchable = [
        session.topic,
        firstUserMessage(session),
        latestAssistantMessage(session),
      ].join(" ").toLowerCase();

      return matchesSessionFilter(session, sessionFilter) && (query || !isSmokeSession(session)) && (!query || searchable.includes(query));
    });
  }, [sessionFilter, sessionSearch, sessions]);
  const groupedSessions = useMemo(() => {
    const groups = new Map<string, CMOChatSession[]>();

    filteredSessions.forEach((session) => {
      const label = sessionGroupLabel(session.createdAt);
      groups.set(label, [...(groups.get(label) ?? []), session]);
    });

    return ["Today", "Yesterday", "Earlier"]
      .map((label) => ({ label, sessions: groups.get(label) ?? [] }))
      .filter((group) => group.sessions.length);
  }, [filteredSessions]);
  const latestSession = sessions[0];
  const latestDisplaySession = sessions.find((session) => !isSmokeSession(session)) ?? latestSession;
  const contextStatus = contextStatusLabel(selectedQuality);
  const appLastUpdated = app.lastUpdated && app.lastUpdated !== "Vault-backed" ? app.lastUpdated : undefined;
  const lastUpdated = appLastUpdated || priorityState.activePriority?.updatedAt || latestDisplaySession?.createdAt || "Workspace context";
  const metricById = useMemo(() => {
    const lookup = new Map<string, CmoAppMetric>();

    metricsSnapshot?.metrics.forEach((metric) => lookup.set(metric.id, metric));

    return lookup;
  }, [metricsSnapshot]);
  const dashboardBaseMetricIds = [
    "activated_users",
    "activation_rate",
    "new_users",
    "d1_retention",
    "d7_retention",
    "pending_reviews",
    "promotions_pending",
  ];
  const promotionsPendingMetric = metricById.get("promotions_pending");
  const metricsHealthLabel = metricsStatus === "loading" ? "Loading" : metricStatusLabel(metricsSnapshot?.status);
  const channelMetricById = useMemo(() => {
    const lookup = new Map<string, CmoChannelMetric>();

    channelMetricsSnapshot?.metrics.forEach((metric) => lookup.set(metric.id, metric));

    return lookup;
  }, [channelMetricsSnapshot]);
  const channelMetric = (id: string) => channelMetricById.get(id);
  const channelMetricsHealthLabel = channelMetricsStatus === "loading" ? "Loading" : channelMetricStatusLabel(channelMetricsSnapshot?.status);
  const channelMetricsHealthVariant = channelMetricsStatus === "loading" ? "slate" : channelMetricStatusVariant(channelMetricsSnapshot?.status);
  const channelMetricsSource = channelSourceLabel(channelMetricsSnapshot?.source);
  const channelMetricsUsingNative = channelMetricsSnapshot?.source === "facebook_native";
  const channelMetricsUsingNativeFallback = channelMetricsSnapshot?.source !== "facebook_native" &&
    channelMetricsSnapshot?.diagnostics.notes.some((note) => /facebook_native_fallback|Fallback: Facebook handoff/i.test(note)) === true;
  const nativeChannelStatus = channelMetricsSnapshot?.sourceMeta?.nativeStatus;
  const nativeChannelPageName = channelMetricsSnapshot?.sourceMeta?.pageName;
  const channelMetricsLastUpdated = channelSyncStatus?.lastFinishedAt
    ? displayDate(channelSyncStatus.lastFinishedAt)
    : channelMetricsSnapshot?.lastUpdatedAt
      ? displayDate(channelMetricsSnapshot.lastUpdatedAt)
      : "Not connected";
  const channelMetricsLastSuccess = channelSyncStatus?.lastSuccessAt ? displayDate(channelSyncStatus.lastSuccessAt) : "Not tracked";
  const channelSyncLabel = channelSyncLoadStatus === "loading" ? "Loading" : channelSyncStatusLabel(channelSyncStatus?.status);
  const channelSyncVariant = channelSyncLoadStatus === "loading" ? "slate" : channelSyncStatusVariant(channelSyncStatus?.status);
  const dexBusinessMetricById = useMemo(() => {
    const lookup = new Map<string, CmoBusinessMetric>();

    dexBusinessMetricsSnapshot?.metrics.forEach((metric) => lookup.set(metric.id, metric));

    return lookup;
  }, [dexBusinessMetricsSnapshot]);
  const feesBusinessMetricById = useMemo(() => {
    const lookup = new Map<string, CmoBusinessMetric>();

    feesBusinessMetricsSnapshot?.metrics.forEach((metric) => lookup.set(metric.id, metric));

    return lookup;
  }, [feesBusinessMetricsSnapshot]);
  const dexBusinessMetric = (id: string) => dexBusinessMetricById.get(id);
  const feesBusinessMetric = (id: string) => feesBusinessMetricById.get(id);
  const businessMetricsCombinedStatus = businessCombinedStatus([dexBusinessMetricsSnapshot, feesBusinessMetricsSnapshot], businessMetricsStatus);
  const businessMetricsHealthLabel = businessMetricsStatus === "loading" ? "Loading" : businessMetricStatusLabel(businessMetricsCombinedStatus);
  const businessMetricsHealthVariant = businessMetricsStatus === "loading" ? "slate" : businessMetricStatusVariant(businessMetricsCombinedStatus);
  const businessMetricsLastUpdated = businessLatestTimestamp([dexBusinessMetricsSnapshot, feesBusinessMetricsSnapshot]);
  const businessMetricSnapshots = [dexBusinessMetricsSnapshot, feesBusinessMetricsSnapshot].filter((snapshot): snapshot is CmoBusinessMetricsSnapshot => Boolean(snapshot));
  const businessMetricsUsingNative = businessMetricSnapshots.some((snapshot) => snapshot.source.sourceId === "dune_native");
  const businessMetricsUsingNativeFallback = businessMetricSnapshots.some((snapshot) => snapshot.sourceStats?.nativeFallback === true);
  const businessMetricQueryNames = Array.from(new Set(businessMetricSnapshots.map((snapshot) => snapshot.source.queryName).filter((value): value is string => typeof value === "string" && Boolean(value.trim()))));
  const businessMetricQueryIds = Array.from(new Set(businessMetricSnapshots.map((snapshot) => snapshot.source.queryId).filter((value): value is string => typeof value === "string" && Boolean(value.trim()))));
  const businessMetricQueryIdsForDisplay = businessMetricQueryIds.length ? businessMetricQueryIds : ["5057875", "5454333"];
  const businessMetricRangeStarts = businessMetricSnapshots.map((snapshot) => snapshot.dateRange.startDate).filter((value): value is string => typeof value === "string" && Boolean(value.trim())).sort();
  const businessMetricRangeEnds = businessMetricSnapshots.map((snapshot) => snapshot.dateRange.endDate).filter((value): value is string => typeof value === "string" && Boolean(value.trim())).sort();
  const businessMetricDateStart = businessMetricRangeStarts[0] ?? null;
  const businessMetricDateEnd = businessMetricRangeEnds[businessMetricRangeEnds.length - 1] ?? null;
  const businessMetricsSourceLabel = businessMetricsUsingNative ? "Dune Native" : "Dune / Worldchain";
  const nativeBusinessStatuses = Array.from(new Set(businessMetricSnapshots
    .filter((snapshot) => snapshot.source.sourceId === "dune_native")
    .map((snapshot) => {
      const sourceStats = snapshot.sourceStats ?? {};
      const stale = sourceStats.stale === true;
      const status = typeof sourceStats.status === "string" && sourceStats.status.trim() ? sourceStats.status.trim() : snapshot.status;

      return stale ? "stale" : status;
    })));
  const hasDexBusinessMetrics = businessSnapshotHasData(dexBusinessMetricsSnapshot);
  const hasFeesBusinessMetrics = businessSnapshotHasData(feesBusinessMetricsSnapshot);
  const hasAnyBusinessMetrics = hasDexBusinessMetrics || hasFeesBusinessMetrics;
  const connectedLensOAuthAccount = lensOAuthAccounts.find((account) => account.status === "connected") ?? null;
  const lensOAuthBadgeVariant = lensOAuthStatus === "loading"
    ? "slate"
    : connectedLensOAuthAccount
      ? "green"
      : lensOAuthConfigured === false || lensOAuthStatus === "error"
        ? "orange"
        : "slate";
  const lensOAuthBadgeLabel = lensOAuthStatus === "loading"
    ? "Loading"
    : connectedLensOAuthAccount
      ? "Connected"
      : lensOAuthConfigured === false
        ? "Config missing"
        : "Not connected";
  const lensOAuthReturnTo = `${pathname}?tab=dashboard`;
  const lensOAuthStartHref = `/api/lens/oauth/google/start?${new URLSearchParams({
    appId: app.id,
    returnTo: lensOAuthReturnTo,
  }).toString()}`;
  const lensOAuthResult = searchParams.get("lensOAuth");
  const lensOAuthResultCode = searchParams.get("lensOAuthCode");
  const selectedGa4Property = ga4Properties.find((property) => property.propertyId === selectedGa4PropertyId) ?? null;
  const mappedGa4PropertyLabel = ga4MetricSourceMapping?.propertyDisplayName || ga4MetricSourceMapping?.propertyId || "Not mapped";
  const ga4SourceIsBusy = ga4MappingStatus === "loading" || ga4PropertiesStatus === "loading" || ga4MappingStatus === "verifying";
  const selectedGa4PropertyIsMapped = Boolean(ga4MetricSourceMapping?.propertyId && selectedGa4PropertyId === ga4MetricSourceMapping.propertyId);
  const ga4VerificationCopy = ga4VerificationStatusCopy(ga4MetricSourceMapping);
  const ga4VerifyButtonLabel = ga4MappingStatus === "verifying"
    ? "Verifying"
    : ga4MetricSourceMapping?.verificationStatus === "verified"
      ? "Verify again"
      : "Verify connection";
  const ga4SnapshotRangeKey = ga4DashboardRangeKey(dateRange);
  const ga4SnapshotSelectedRangeLabel = dateRangeOptions.find((option) => option.id === ga4SnapshotRangeKey)?.label ?? "This week";
  const ga4SnapshotIsStale = isGa4SnapshotStale(ga4MetricSnapshot, ga4SnapshotRangeKey);
  const ga4SnapshotHealth = ga4SnapshotHealthLabel({
    loadStatus: ga4SnapshotStatus,
    snapshot: ga4MetricSnapshot,
    stale: ga4SnapshotIsStale,
  });
  const ga4SnapshotHealthBadgeVariant = ga4SnapshotHealthVariant(ga4SnapshotHealth);
  const ga4SnapshotRangeLabel = ga4MetricSnapshot
    ? `${ga4MetricSnapshot.dateStart} to ${ga4MetricSnapshot.dateEnd}`
    : ga4SnapshotSelectedRangeLabel;
  const ga4SyncButtonLabel = ga4SnapshotStatus === "syncing" ? "Syncing GA4 metrics" : "Sync GA4 metrics";
  const ga4SourceBadgeVariant = ga4VerificationBadgeVariant({
    loading: ga4SourceIsBusy,
    mapping: ga4MetricSourceMapping,
    fallbackVariant: lensOAuthBadgeVariant,
  });
  const ga4SourceBadgeLabel = ga4VerificationBadgeLabel({
    loading: ga4SourceIsBusy,
    mapping: ga4MetricSourceMapping,
    fallbackLabel: lensOAuthBadgeLabel,
  });
  const metricDefinitionRange = metricDefinitionRangeKey(dateRange);
  const activationDefinition = metricDefinitions.find((definition) => definition.definition_type === "activation");
  const retentionDefinition = metricDefinitions.find((definition) => definition.definition_type === "retention");
  const activationSnapshot = metricDefinitionSnapshots.find((snapshot) => snapshot.definition_type === "activation");
  const retentionSnapshot = metricDefinitionSnapshots.find((snapshot) => snapshot.definition_type === "retention");
  const activationDefinitionConfigured = Boolean(activationDefinition?.enabled);
  const retentionDefinitionConfigured = Boolean(retentionDefinition?.enabled);
  const activationStatusLabel = activationDefinitionConfigured ? "Configured" : "Not configured";
  const retentionStatusLabel = retentionDefinitionConfigured ? "Configured" : "Not configured";
  const activatedUsersCard = metricDefinitionCardCopy({
    kind: "activation_users",
    snapshot: activationSnapshot,
    definition: activationDefinition,
  });
  const activationRateCard = metricDefinitionCardCopy({
    kind: "activation_rate",
    snapshot: activationSnapshot,
    definition: activationDefinition,
  });
  const d1RetentionCard = metricDefinitionCardCopy({
    kind: "retention_d1",
    snapshot: retentionSnapshot,
    definition: retentionDefinition,
  });
  const d7RetentionCard = metricDefinitionCardCopy({
    kind: "retention_d7",
    snapshot: retentionSnapshot,
    definition: retentionDefinition,
  });
  const ga4MappedStatus = (
    <div className="flex flex-wrap justify-end gap-1">
      <Badge variant="green">Connected</Badge>
      <Badge variant={ga4SnapshotHealthBadgeVariant}>{ga4SnapshotHealth}</Badge>
    </div>
  );
  const ga4MissingStatus = <Badge variant={ga4SnapshotHealth === "Error" ? "red" : "slate"}>{ga4SnapshotHealth === "Error" ? "Error" : "Not configured"}</Badge>;
  const ga4MappedMetricDetail = ga4MetricSnapshot?.status === "synced" ? "GA4 core metric." : "Sync GA4 metrics to populate GA4 core metric.";
  const dashboardMetricCards = [
    ...dashboardBaseMetricIds.map((id) => {
      const metric = metricById.get(id);
      const requiresDefinition = id === "activated_users" || id === "activation_rate" || id === "d1_retention" || id === "d7_retention";
      const isNewUsers = id === "new_users";
      const label = metric?.label ?? (isNewUsers ? "New Users" : id);
      const newUsers = ga4MetricSnapshot?.metrics.newUsers;

      if (isNewUsers && isGa4SyncedNumber(ga4MetricSnapshot, newUsers)) {
        return {
          id,
          label: "New Users",
          value: compactMetricValue(newUsers),
          detail: ga4MappedMetricDetail,
          muted: false,
          status: ga4MappedStatus,
          comparison: comparePrevious ? "GA4 comparison not connected yet." : null,
        };
      }

      if (requiresDefinition) {
        const definedCard = id === "activated_users"
          ? activatedUsersCard
          : id === "activation_rate"
            ? activationRateCard
            : id === "d1_retention"
              ? d1RetentionCard
              : d7RetentionCard;

        return {
          id,
          label,
          ...definedCard,
          comparison: null,
        };
      }

      return {
        id,
        label,
        value: metric?.status === "connected" && metric.value !== null ? metric.displayValue : "No data",
        detail: metric?.status === "connected" ? metric.description : isNewUsers ? "Sync GA4 metrics to populate GA4 core metric." : "No metrics source connected yet.",
        muted: metric?.status !== "connected",
        status: isNewUsers ? ga4MissingStatus : <Badge variant={metricStatusVariant(metric?.status)}>{metric?.status === "connected" ? "Connected" : "Metrics missing"}</Badge>,
        comparison: comparePrevious ? metric?.deltaDisplay || "No comparison data" : null,
      };
    }),
    {
      id: "ga4_sessions",
      label: "Sessions",
      value: compactMetricValue(ga4MetricSnapshot?.metrics.sessions),
      detail: ga4MappedMetricDetail,
      muted: !isGa4SyncedNumber(ga4MetricSnapshot, ga4MetricSnapshot?.metrics.sessions),
      status: isGa4SyncedNumber(ga4MetricSnapshot, ga4MetricSnapshot?.metrics.sessions) ? ga4MappedStatus : ga4MissingStatus,
      comparison: comparePrevious ? "GA4 comparison not connected yet." : null,
    },
    {
      id: "ga4_event_count",
      label: "Event Count",
      value: compactMetricValue(ga4MetricSnapshot?.metrics.eventCount),
      detail: ga4MappedMetricDetail,
      muted: !isGa4SyncedNumber(ga4MetricSnapshot, ga4MetricSnapshot?.metrics.eventCount),
      status: isGa4SyncedNumber(ga4MetricSnapshot, ga4MetricSnapshot?.metrics.eventCount) ? ga4MappedStatus : ga4MissingStatus,
      comparison: comparePrevious ? "GA4 comparison not connected yet." : null,
    },
    {
      id: "ga4_engagement_rate",
      label: "Engagement Rate",
      value: percentMetricValue(ga4MetricSnapshot?.metrics.engagementRate),
      detail: ga4MappedMetricDetail,
      muted: !isGa4SyncedNumber(ga4MetricSnapshot, ga4MetricSnapshot?.metrics.engagementRate),
      status: isGa4SyncedNumber(ga4MetricSnapshot, ga4MetricSnapshot?.metrics.engagementRate) ? ga4MappedStatus : ga4MissingStatus,
      comparison: comparePrevious ? "GA4 comparison not connected yet." : null,
    },
  ];

  useEffect(() => {
    const nextTab = workspaceTabFromParam(tabParam);
    const timeout = window.setTimeout(() => {
      setActiveTab((current) => (current === nextTab ? current : nextTab));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [tabParam]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      range: dateRange,
      compare: comparePrevious ? "true" : "false",
    });

    async function loadMetrics() {
      setMetricsStatus("loading");
      setMetricsError(null);

      try {
        const payload = await readJsonResponse<{ data: CmoAppMetricsSnapshot }>(
          await fetch(`/api/cmo/apps/${app.id}/metrics?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );

        if (!controller.signal.aborted) {
          setMetricsSnapshot(payload.data);
          setMetricsStatus("ready");
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setMetricsStatus("error");
        setMetricsError(loadError instanceof Error ? loadError.message : "Metrics load failed");
      }
    }

    void loadMetrics();

    return () => controller.abort();
  }, [app.id, comparePrevious, dateRange]);

  useEffect(() => {
    if (!showChannelPerformance) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      channel: "facebook",
      range: dateRange,
    });

    async function loadChannelMetrics() {
      setChannelMetricsStatus("loading");
      setChannelMetricsError(null);

      try {
        const payload = await readJsonResponse<{ data: CmoChannelMetricsSnapshot }>(
          await fetch(`/api/cmo/apps/${app.id}/channel-metrics?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );

        if (!controller.signal.aborted) {
          setChannelMetricsSnapshot(payload.data);
          setChannelMetricsStatus("ready");
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setChannelMetricsStatus("error");
        setChannelMetricsError(loadError instanceof Error ? loadError.message : "Channel metrics load failed");
      }
    }

    void loadChannelMetrics();

    return () => controller.abort();
  }, [app.id, dateRange, showChannelPerformance]);

  useEffect(() => {
    if (!showBusinessMetrics) {
      return;
    }

    const controller = new AbortController();

    async function loadBusinessMetrics() {
      setBusinessMetricsStatus("loading");
      setBusinessMetricsError(null);

      try {
        const [dexResult, feesResult] = await Promise.allSettled([
          readJsonResponse<{ data: CmoBusinessMetricsSnapshot }>(
            await fetch(`/api/cmo/apps/${app.id}/business-metrics?source=dune&group=wld_aggregator_daily`, {
              cache: "no-store",
              signal: controller.signal,
            }),
          ),
          readJsonResponse<{ data: CmoBusinessMetricsSnapshot }>(
            await fetch(`/api/cmo/apps/${app.id}/business-metrics?source=dune&group=wld_partner_stats_daily`, {
              cache: "no-store",
              signal: controller.signal,
            }),
          ),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        setDexBusinessMetricsSnapshot(dexResult.status === "fulfilled" ? dexResult.value.data : null);
        setFeesBusinessMetricsSnapshot(feesResult.status === "fulfilled" ? feesResult.value.data : null);
        setBusinessMetricsStatus(dexResult.status === "fulfilled" || feesResult.status === "fulfilled" ? "ready" : "error");

        if (dexResult.status === "rejected" && feesResult.status === "rejected") {
          setBusinessMetricsError("Business metrics load failed");
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setBusinessMetricsStatus("error");
        setBusinessMetricsError(loadError instanceof Error ? loadError.message : "Business metrics load failed");
      }
    }

    void loadBusinessMetrics();

    return () => controller.abort();
  }, [app.id, showBusinessMetrics]);

  useEffect(() => {
    if (!showChannelPerformance) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      channel: "facebook",
    });

    async function loadChannelSyncStatus() {
      setChannelSyncLoadStatus("loading");

      try {
        const payload = await readJsonResponse<{ data: CmoChannelMetricsSyncStatus }>(
          await fetch(`/api/cmo/apps/${app.id}/channel-metrics/sync-status?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );

        if (!controller.signal.aborted) {
          setChannelSyncStatus(payload.data);
          setChannelSyncLoadStatus("ready");
        }
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setChannelSyncStatus(null);
        setChannelSyncLoadStatus("error");
      }
    }

    void loadChannelSyncStatus();

    return () => controller.abort();
  }, [app.id, showChannelPerformance]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      appId: app.id,
    });

    async function loadLensOAuthAccounts() {
      setLensOAuthStatus("loading");
      setLensOAuthError(null);

      try {
        const payload = await readJsonResponse<LensOAuthAccountsResponse>(
          await fetch(`/api/lens/oauth/google/accounts?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );

        if (!controller.signal.aborted) {
          setLensOAuthAccounts(payload.data);
          setLensOAuthConfigured(payload.oauthConfigured);
          setLensOAuthMissingConfig(payload.missingConfig);
          setLensOAuthStatus("ready");
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setLensOAuthAccounts([]);
        setLensOAuthStatus("error");
        setLensOAuthError(loadError instanceof Error ? loadError.message : "Lens OAuth status load failed");
      }
    }

    void loadLensOAuthAccounts();

    return () => controller.abort();
  }, [app.id]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadGa4MetricSourceMapping() {
      setGa4MappingStatus("loading");
      setGa4MappingError(null);

      try {
        const payload = await readJsonResponse<WorkspaceGa4MetricSourceResponse>(
          await fetch(`/api/cmo/apps/${app.id}/metric-sources/ga4`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );

        if (!controller.signal.aborted) {
          setGa4MetricSourceMapping(payload.data);
          setSelectedGa4PropertyId((current) => payload.data?.propertyId ?? current);
          setGa4MappingStatus("ready");
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setGa4MetricSourceMapping(null);
        setGa4MappingStatus("error");
        setGa4MappingError(loadError instanceof Error ? loadError.message : "GA4 mapping load failed");
      }
    }

    void loadGa4MetricSourceMapping();

    return () => controller.abort();
  }, [app.id]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadGa4MetricSnapshot() {
      setGa4SnapshotStatus("loading");
      setGa4SnapshotError(null);

      try {
        const payload = await readJsonResponse<WorkspaceGa4MetricSnapshotResponse>(
          await fetch(`/api/cmo/apps/${app.id}/metric-sources/ga4/snapshots?rangeKey=${ga4SnapshotRangeKey}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );

        if (!controller.signal.aborted) {
          setGa4MetricSnapshot(payload.data);
          setGa4SnapshotStatus("ready");
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setGa4MetricSnapshot(null);
        setGa4SnapshotStatus("error");
        setGa4SnapshotError(loadError instanceof Error ? loadError.message : "GA4 metric snapshot load failed");
      }
    }

    void loadGa4MetricSnapshot();

    return () => controller.abort();
  }, [app.id, ga4SnapshotRangeKey]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadMetricDefinitions() {
      setMetricDefinitionsStatus("loading");
      setMetricDefinitionsError(null);

      try {
        const payload = await readJsonResponse<ProductMetricDefinitionsResponse>(
          await fetch(`/api/cmo/apps/${app.id}/metric-definitions`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );

        if (!controller.signal.aborted) {
          setMetricDefinitions(payload.definitions);
          const activation = payload.definitions.find((definition) => definition.definition_type === "activation");
          const retention = payload.definitions.find((definition) => definition.definition_type === "retention");
          const activationEvents = Array.isArray(activation?.definition.activation_events)
            ? activation.definition.activation_events.filter((item): item is string => typeof item === "string")
            : [];
          const denominator = activation?.definition.denominator;
          const retentionEvents = Array.isArray(retention?.definition.retention_return_events)
            ? retention.definition.retention_return_events.filter((item): item is string => typeof item === "string")
            : [];

          setActivationEventsInput(activationEvents.join(", "));
          setActivationDenominator(denominator === "new_users" || denominator === "total_users" ? denominator : "active_users");
          setRetentionEventsInput(retentionEvents.join(", "));
          setMetricDefinitionsStatus("ready");
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setMetricDefinitions([]);
        setMetricDefinitionsStatus("error");
        setMetricDefinitionsError(loadError instanceof Error ? loadError.message : "Metric definitions load failed");
      }
    }

    void loadMetricDefinitions();

    return () => controller.abort();
  }, [app.id]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadMetricDefinitionSnapshots() {
      try {
        const payload = await readJsonResponse<ProductMetricDefinitionSnapshotsResponse>(
          await fetch(`/api/cmo/apps/${app.id}/metric-definitions/snapshots?rangeKey=${metricDefinitionRange}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );

        if (!controller.signal.aborted) {
          setMetricDefinitionSnapshots(payload.snapshots);
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setMetricDefinitionSnapshots([]);
        setMetricDefinitionsError(loadError instanceof Error ? loadError.message : "Metric definition snapshots load failed");
      }
    }

    void loadMetricDefinitionSnapshots();

    return () => controller.abort();
  }, [app.id, metricDefinitionRange]);

  useEffect(() => {
    if (!connectedLensOAuthAccount) {
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      appId: app.id,
      oauthAccountId: connectedLensOAuthAccount.id,
    });

    async function loadGa4Properties() {
      setGa4PropertiesStatus("loading");
      setGa4PropertiesError(null);

      try {
        const payload = await readJsonResponse<LensGa4PropertiesResponse>(
          await fetch(`/api/lens/ga4/properties?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        );

        if (!controller.signal.aborted) {
          const properties = payload.data.properties;
          setGa4Properties(properties);
          setSelectedGa4PropertyId((current) => {
            const mappedId = ga4MetricSourceMapping?.propertyId;

            if (mappedId && properties.some((property) => property.propertyId === mappedId)) {
              return mappedId;
            }

            if (current && properties.some((property) => property.propertyId === current)) {
              return current;
            }

            return properties[0]?.propertyId ?? "";
          });
          setGa4PropertiesStatus("ready");
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }

        setGa4Properties([]);
        setGa4PropertiesStatus("error");
        setGa4PropertiesError(loadError instanceof Error ? loadError.message : "GA4 property discovery failed");
      }
    }

    void loadGa4Properties();

    return () => controller.abort();
  }, [app.id, connectedLensOAuthAccount, ga4MetricSourceMapping?.propertyId]);

  async function refreshWorkspace() {
    const payload = await readJsonResponse<{ data: AppWorkspaceState }>(
      await fetch(`/api/apps/${app.id}/workspace`, { cache: "no-store" }),
    );

    setContextBrief(payload.data.contextBrief);
    setPriorityState(payload.data.priorityState);
    setPlans(payload.data.plans);
    setLatestPromotion(payload.data.latestPromotion);
    setMemoryRefreshSignal((current) => current + 1);

    return payload.data;
  }

  async function refreshWorkspaceAfterMemoryChange() {
    await refreshWorkspace();
    setPromotionRefreshSignal((current) => current + 1);
    router.refresh();
  }

  async function refreshSessions(preferredSessionId?: string) {
    const payload = await readJsonResponse<{ data: CMOChatSession[] }>(await fetch(`/api/apps/${app.id}/sessions?limit=50`, { cache: "no-store" }));
    setSessions(payload.data);
    setSelectedSessionId((current) => {
      if (preferredSessionId) {
        return preferredSessionId;
      }

      if (current && payload.data.some((session) => session.id === current)) {
        return current;
      }

      return current === null ? null : payload.data.find((session) => !isSmokeSession(session))?.id ?? payload.data[0]?.id ?? null;
    });
    return payload.data;
  }

  function focusCurrentCmoSession() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "sessions");
    const target = `${pathname}?${next.toString()}`;

    setActiveTab("sessions");
    setSelectedSessionId(null);
    setSessionFocusSignal((current) => current + 1);

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", target);
    }

    router.replace(target, { scroll: false });
  }

  async function saveGa4MetricSource() {
    if (!connectedLensOAuthAccount || !selectedGa4Property) {
      setGa4MappingError("Choose a connected Google account and GA4 property first.");
      return;
    }

    setGa4MappingStatus("saving");
    setGa4MappingError(null);

    try {
      const payload = await readJsonResponse<{ data: WorkspaceGa4MetricSourceMapping }>(
        await fetch(`/api/cmo/apps/${app.id}/metric-sources/ga4`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            oauthAccountId: connectedLensOAuthAccount.id,
            propertyId: selectedGa4Property.propertyId,
            propertyDisplayName: selectedGa4Property.displayName,
            accountId: selectedGa4Property.accountId,
            accountDisplayName: selectedGa4Property.accountName,
            timezone: selectedGa4Property.timezone,
          }),
        }),
      );

      setGa4MetricSourceMapping(payload.data);
      setSelectedGa4PropertyId(payload.data.propertyId);
      setGa4MappingStatus("ready");
    } catch (error) {
      setGa4MappingStatus("error");
      setGa4MappingError(error instanceof Error ? error.message : "GA4 mapping save failed");
    }
  }

  async function verifyGa4MetricSource() {
    if (!ga4MetricSourceMapping?.enabled) {
      setGa4MappingError("Save a GA4 property before verification.");
      return;
    }

    setGa4MappingStatus("verifying");
    setGa4MappingError(null);

    try {
      const payload = await readJsonResponse<WorkspaceGa4VerificationResponse>(
        await fetch(`/api/cmo/apps/${app.id}/metric-sources/ga4/verify`, {
          method: "POST",
          cache: "no-store",
        }),
      );

      setGa4MetricSourceMapping(payload.mapping);
      setSelectedGa4PropertyId((current) => payload.mapping?.propertyId ?? current);
      setGa4MappingStatus("ready");
    } catch (error) {
      setGa4MappingStatus("error");
      setGa4MappingError(error instanceof Error ? error.message : "GA4 source verification failed");
    }
  }

  async function syncGa4MetricSnapshot() {
    if (ga4MetricSourceMapping?.verificationStatus !== "verified") {
      setGa4SnapshotError("Verify the GA4 source before syncing metrics.");
      return;
    }

    setGa4SnapshotStatus("syncing");
    setGa4SnapshotError(null);

    try {
      const payload = await readJsonResponse<WorkspaceGa4MetricSnapshotResponse>(
        await fetch(`/api/cmo/apps/${app.id}/metric-sources/ga4/sync?rangeKey=${ga4SnapshotRangeKey}`, {
          method: "POST",
          cache: "no-store",
        }),
      );

      setGa4MetricSnapshot(payload.data);
      setGa4SnapshotStatus("ready");
    } catch (error) {
      setGa4SnapshotStatus("error");
      setGa4SnapshotError(error instanceof Error ? error.message : "GA4 metric sync failed");
    }
  }

  async function reloadMetricDefinitionSnapshots() {
    const payload = await readJsonResponse<ProductMetricDefinitionSnapshotsResponse>(
      await fetch(`/api/cmo/apps/${app.id}/metric-definitions/snapshots?rangeKey=${metricDefinitionRange}`, {
        cache: "no-store",
      }),
    );

    setMetricDefinitionSnapshots(payload.snapshots);
  }

  async function saveMetricDefinitions() {
    const activationEvents = activationEventsInput.split(",").map((item) => item.trim()).filter(Boolean);
    const retentionEvents = retentionEventsInput.split(",").map((item) => item.trim()).filter(Boolean);

    setMetricDefinitionsStatus("saving");
    setMetricDefinitionsError(null);

    try {
      const payload = await readJsonResponse<ProductMetricDefinitionsResponse>(
        await fetch(`/api/cmo/apps/${app.id}/metric-definitions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            definitions: [
              {
                definition_type: "activation",
                enabled: activationEvents.length > 0,
                definition: {
                  activation_events: activationEvents,
                  activation_logic: "any_event",
                  denominator: activationDenominator,
                  activation_window: "same_range",
                },
              },
              {
                definition_type: "retention",
                enabled: retentionEvents.length > 0,
                definition: {
                  retention_return_events: retentionEvents,
                  retention_days: [1, 7],
                  retention_method: "ga4_cohort",
                },
              },
            ],
          }),
        }),
      );

      setMetricDefinitions(payload.definitions);
      setMetricDefinitionsStatus("ready");
    } catch (error) {
      setMetricDefinitionsStatus("error");
      setMetricDefinitionsError(error instanceof Error ? error.message : "Metric definitions save failed");
    }
  }

  async function computeMetricDefinitions() {
    if (ga4MetricSourceMapping?.verificationStatus !== "verified") {
      setMetricDefinitionsError("Verify the GA4 source before computing defined metrics.");
      return;
    }

    setMetricDefinitionsStatus("computing");
    setMetricDefinitionsError(null);

    try {
      await readJsonResponse<ProductMetricDefinitionComputeResponse>(
        await fetch(`/api/cmo/apps/${app.id}/metric-definitions/compute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rangeKeys: [metricDefinitionRange],
            definitionTypes: ["activation", "retention"],
            mode: "refresh_all",
            trigger: "manual",
            dryRun: false,
          }),
        }),
      );
      await reloadMetricDefinitionSnapshots();
      setMetricDefinitionsStatus("ready");
    } catch (error) {
      setMetricDefinitionsStatus("error");
      setMetricDefinitionsError(error instanceof Error ? error.message : "Metric definition compute failed");
    }
  }

  async function createPlan(type: AppPlanType) {
    setPlanStatus(null);
    setPlanError(null);

    try {
      const payload = await readJsonResponse<{ data: AppWorkspacePlanState }>(
        await fetch(`/api/apps/${app.id}/plans`, {
          cache: "no-store",
        }),
      );
      const current = type === "weekly" ? payload.data.weekly : payload.data.monthly;

      if (current.exists) {
        setPlans(payload.data);
        setPlanStatus(`${type === "weekly" ? "Weekly" : "Monthly"} plan already exists at ${current.path}`);
        return;
      }

      await readJsonResponse(
        await fetch(`/api/apps/${app.id}/plans`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ type }),
        }),
      );

      const refreshed = await readJsonResponse<{ data: AppWorkspacePlanState }>(await fetch(`/api/apps/${app.id}/plans`, { cache: "no-store" }));
      setPlans(refreshed.data);
      setPlanStatus(`Created ${type} plan.`);
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Plan creation failed");
    }
  }

  function sessionHistoryPanel() {
    const filters: Array<{ id: SessionFilter; label: string }> = [
      { id: "all", label: "All" },
      { id: "live", label: "Live" },
    ];

    return (
      <div className="space-y-3">
        <Input
          value={sessionSearch}
          onChange={(event) => setSessionSearch(event.target.value)}
          placeholder="Search sessions..."
          className="h-9 text-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setSessionFilter(filter.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold transition",
                sessionFilter === filter.id ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {groupedSessions.length ? (
          <div className="space-y-4">
            {groupedSessions.map((group) => (
              <div key={group.label} className="space-y-2">
                <div className="px-1 text-[11px] font-bold uppercase text-slate-400">{group.label}</div>
                {group.sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setSelectedSessionId(session.id)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left transition",
                      selectedSessionId === session.id ? "border-indigo-200 bg-indigo-50" : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    <div className="truncate text-sm font-bold text-slate-950">{session.topic || firstUserMessage(session) || "CMO session"}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                      <span>{displayDate(session.createdAt)}</span>
                      <span>·</span>
                      {session.runtimeMode === "live" || session.runtimeStatus === "live" ? <Badge variant="green">Live</Badge> : null}
                      <Badge variant={sessionOutputCount(session) ? "blue" : "slate"}>{sessionOutputCount(session)} outputs</Badge>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <EmptyCopy>No sessions match this view.</EmptyCopy>
        )}
      </div>
    );
  }

  const headerActions = (
    <Button type="button" onClick={focusCurrentCmoSession}>
      <icons.MessageSquare />
      Start CMO Session
    </Button>
  );

  return (
    <PageChrome title={app.name} description="Executive app workspace with chat-first CMO review and workspace context." actions={headerActions}>
      <Card className="overflow-hidden rounded-lg border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={app.stage === "Active" ? "green" : "slate"}>{app.stage || "Unknown stage"}</Badge>
            <Badge title={state.initialRuntimeStatus ?? "not_checked"} variant={runtimeVariant(state.initialRuntimeStatus)}>{runtimeLabel(state.initialRuntimeStatus)}</Badge>
            <Badge variant={contextStatusVariant(contextStatus)}>Context: {contextStatus}</Badge>
          </div>
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold tracking-tight text-slate-950">{app.name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                <span>Updated {displayDate(lastUpdated)}</span>
                <span title={metricsError ?? undefined}>Metrics {metricsHealthLabel}</span>
                <span>Workspace context enabled</span>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500">
              <input
                type="checkbox"
                checked={comparePrevious}
                onChange={(event) => setComparePrevious(event.target.checked)}
                className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Compare
            </label>
          </div>

          <div className="mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {dateRangeOptions.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={dateRange === option.id ? "default" : "outline"}
                className={cn("shrink-0 rounded-md", dateRange === option.id ? "shadow-sm hover:translate-y-0" : "hover:translate-y-0")}
                onClick={() => setDateRange(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        {dateRange === "custom" ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
            Custom date range picker is not connected yet. The endpoint currently uses the current date for custom ranges unless explicit dates are supplied.
          </div>
        ) : null}

        {activeTab === "dashboard" ? (
          <div className="border-t border-slate-200 p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
              {dashboardMetricCards.map((metric) => (
                <KpiCard
                  key={metric.id}
                  label={metric.label}
                  value={metric.value}
                  detail={metric.detail}
                  muted={metric.muted}
                  status={metric.status}
                  comparison={metric.comparison}
                />
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <nav className="rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={`${pathname}?tab=${tab.id}`}
              aria-current={activeTab === tab.id ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center justify-center rounded-md px-3 text-sm font-semibold transition",
                activeTab === tab.id ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
              )}
            >
                {tab.label}
            </Link>
          ))}
        </div>
      </nav>

      {activeTab === "dashboard" ? (
        <div className="space-y-6">
          <SectionCard
            title="Lens GA4"
            icon={<icons.KeyRound />}
            action={<Badge variant={ga4SourceBadgeVariant}>{ga4SourceBadgeLabel}</Badge>}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div>
                <div className="text-sm font-bold text-slate-950">
                  {connectedLensOAuthAccount?.googleEmail ?? "Google Analytics account not connected"}
                </div>
                <div className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                  {lensOAuthResult === "connected"
                    ? "GA4 OAuth is connected. Choose a GA4 property for this workspace."
                    : lensOAuthResult === "error"
                      ? `Google OAuth did not complete${lensOAuthResultCode ? ` (${lensOAuthResultCode})` : ""}.`
                      : ga4MetricSourceMapping?.enabled
                        ? `Connected + Property: ${mappedGa4PropertyLabel} / ${ga4MetricSourceMapping.propertyId}`
                        : connectedLensOAuthAccount
                          ? `Connected ${displayDate(connectedLensOAuthAccount.updatedAt)}. Choose a GA4 property for this workspace.`
                        : lensOAuthConfigured === false
                          ? "Google OAuth server configuration is incomplete."
                          : lensOAuthError || "Connect GA4 to authorize Product-side Lens access."}
                </div>
                <div className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  Property discovery enabled. Metrics fetching comes in M6.4. Current dashboard values load from the latest cached Lens snapshot for the selected range.
                </div>
                {ga4MetricSnapshot?.status === "synced" ? (
                  <div className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                    GA4 core metrics synced. Lens interpretation comes later.
                  </div>
                ) : null}
                {ga4VerificationCopy ? (
                  <div className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                    {ga4VerificationCopy}
                  </div>
                ) : null}
                {lensOAuthMissingConfig.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {lensOAuthMissingConfig.map((name) => (
                      <Badge key={name} variant="orange">{name}</Badge>
                    ))}
                  </div>
                ) : null}
                {connectedLensOAuthAccount ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="slate">Provider: Google</Badge>
                    <Badge variant="slate">Scopes: {connectedLensOAuthAccount.scopes.length}</Badge>
                    <Badge variant="slate">Tenant: {connectedLensOAuthAccount.tenantId}</Badge>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="slate">Source: Lens GA4</Badge>
                  <Badge variant="slate">Auto sync: hourly</Badge>
                  <Badge variant={ga4SnapshotHealthBadgeVariant}>{ga4SnapshotHealth}</Badge>
                  <Badge variant="slate">Range: {ga4SnapshotSelectedRangeLabel}</Badge>
                  <Badge variant="slate">Last synced: {ga4MetricSnapshot?.syncedAt ? displayDate(ga4MetricSnapshot.syncedAt) : "No snapshot yet"}</Badge>
                </div>
                {ga4MetricSnapshot?.status === "error" || ga4SnapshotStatus === "error" || !ga4MetricSnapshot ? (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-600">
                    {ga4MetricSnapshot?.status === "error"
                      ? ga4MetricSnapshot.lastError || "Latest GA4 snapshot ended in an error."
                      : ga4SnapshotStatus === "error"
                        ? ga4SnapshotError || "GA4 snapshot load failed."
                        : "No GA4 snapshot for this range yet. Sync GA4 metrics after source verification."}
                  </div>
                ) : null}
                {ga4MetricSourceMapping?.enabled ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <FieldValue label="Property" value={`${mappedGa4PropertyLabel} / ${ga4MetricSourceMapping.propertyId}`} />
                    <FieldValue label="Account" value={ga4MetricSourceMapping.accountDisplayName ?? ga4MetricSourceMapping.accountId} />
                    <FieldValue label="Timezone" value={ga4MetricSourceMapping.timezone ?? "Not returned"} />
                    <FieldValue label="Last verified" value={ga4MetricSourceMapping.lastVerifiedAt ? displayDate(ga4MetricSourceMapping.lastVerifiedAt) : "Not verified yet"} />
                    <FieldValue label="Latest synced" value={ga4MetricSnapshot?.syncedAt ? `${displayDate(ga4MetricSnapshot.syncedAt)} / ${ga4SnapshotRangeLabel}` : "No snapshot yet"} />
                  </div>
                ) : null}
                {ga4MetricSnapshot?.status === "synced" ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <FieldValue label="Active users" value={compactMetricValue(ga4MetricSnapshot.metrics.activeUsers)} />
                    <FieldValue label="New users" value={compactMetricValue(ga4MetricSnapshot.metrics.newUsers)} />
                    <FieldValue label="Sessions" value={compactMetricValue(ga4MetricSnapshot.metrics.sessions)} />
                    <FieldValue label="Event count" value={compactMetricValue(ga4MetricSnapshot.metrics.eventCount)} />
                    <FieldValue label="Engagement rate" value={percentMetricValue(ga4MetricSnapshot.metrics.engagementRate)} />
                  </div>
                ) : null}
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-950">Metric Definitions</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant={activationDefinitionConfigured ? "green" : "orange"}>Activation: {activationStatusLabel}</Badge>
                        <Badge variant={retentionDefinitionConfigured ? "green" : "orange"}>Retention: {retentionStatusLabel}</Badge>
                        <Badge variant={metricDefinitionStatusVariant(activationSnapshot?.status)}>Activation compute: {metricDefinitionStatusLabel(activationSnapshot?.status)}</Badge>
                        <Badge variant={metricDefinitionStatusVariant(retentionSnapshot?.status)}>Retention compute: {metricDefinitionStatusLabel(retentionSnapshot?.status)}</Badge>
                      </div>
                      <div className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                        Last computed: {activationSnapshot?.generated_at ? displayDate(activationSnapshot.generated_at) : retentionSnapshot?.generated_at ? displayDate(retentionSnapshot.generated_at) : "No definition snapshot yet"}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => void saveMetricDefinitions()} disabled={metricDefinitionsStatus === "saving" || metricDefinitionsStatus === "computing"}>
                        <icons.Check />
                        {metricDefinitionsStatus === "saving" ? "Saving" : "Save definitions"}
                      </Button>
                      <Button type="button" size="sm" onClick={() => void computeMetricDefinitions()} disabled={metricDefinitionsStatus === "saving" || metricDefinitionsStatus === "computing" || ga4MetricSourceMapping?.verificationStatus !== "verified"}>
                        <icons.RefreshCw />
                        {metricDefinitionsStatus === "computing" ? "Computing" : "Compute now"}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)]">
                    <Field label="Activation events">
                      <Input
                        value={activationEventsInput}
                        onChange={(event) => setActivationEventsInput(event.target.value)}
                        placeholder="activation_event_one, activation_event_two"
                      />
                    </Field>
                    <Field label="Activation denominator">
                      <select
                        value={activationDenominator}
                        onChange={(event) => setActivationDenominator(event.target.value as typeof activationDenominator)}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                      >
                        <option value="active_users">Active users</option>
                        <option value="new_users">New users</option>
                        <option value="total_users">Total users</option>
                      </select>
                    </Field>
                    <Field label="Retention return events">
                      <Input
                        value={retentionEventsInput}
                        onChange={(event) => setRetentionEventsInput(event.target.value)}
                        placeholder="session_start, user_engagement"
                      />
                    </Field>
                  </div>
                  {metricDefinitionsError ? (
                    <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">
                      {metricDefinitionsError}
                    </div>
                  ) : null}
                </div>
                {connectedLensOAuthAccount ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-end">
                    <Field label="Choose GA4 property">
                      <select
                        value={selectedGa4PropertyId}
                        onChange={(event) => setSelectedGa4PropertyId(event.target.value)}
                        disabled={ga4PropertiesStatus === "loading" || !ga4Properties.length}
                        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        {ga4Properties.length ? (
                          ga4Properties.map((property) => (
                            <option key={property.propertyId} value={property.propertyId}>
                              {property.accountName ? `${property.accountName} / ` : ""}{property.displayName} / {property.propertyId}
                            </option>
                          ))
                        ) : (
                          <option value="">
                            {ga4PropertiesStatus === "loading" ? "Loading GA4 properties..." : "No GA4 properties available"}
                          </option>
                        )}
                      </select>
                    </Field>
                    <Button
                      type="button"
                      onClick={() => void saveGa4MetricSource()}
                      disabled={!selectedGa4Property || selectedGa4PropertyIsMapped || ga4MappingStatus === "saving" || ga4MappingStatus === "verifying" || ga4PropertiesStatus === "loading"}
                    >
                      <icons.Check />
                      {ga4MappingStatus === "saving"
                        ? "Saving"
                        : selectedGa4PropertyIsMapped
                          ? "Saved"
                          : ga4MetricSourceMapping?.verificationStatus === "property_inaccessible"
                            ? "Choose another property"
                            : "Save property"}
                    </Button>
                    {ga4MetricSourceMapping?.enabled && ga4MetricSourceMapping.verificationStatus !== "needs_reconnect" ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void verifyGa4MetricSource()}
                        disabled={ga4MappingStatus === "saving" || ga4MappingStatus === "verifying"}
                      >
                        <icons.RefreshCw />
                        {ga4VerifyButtonLabel}
                      </Button>
                    ) : null}
                    {ga4MetricSourceMapping?.verificationStatus === "verified" ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void syncGa4MetricSnapshot()}
                        disabled={ga4SnapshotStatus === "syncing" || ga4MappingStatus === "saving" || ga4MappingStatus === "verifying"}
                      >
                        <icons.RefreshCw />
                        {ga4SyncButtonLabel}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {ga4PropertiesError || ga4MappingError || ga4SnapshotError ? (
                  <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">
                    {ga4PropertiesError || ga4MappingError || ga4SnapshotError}
                  </div>
                ) : null}
              </div>
              {lensOAuthConfigured === false ? (
                <Button type="button" disabled>
                  <icons.KeyRound />
                  Connect GA4
                </Button>
              ) : (
                <Button asChild>
                  <a href={lensOAuthStartHref}>
                    <icons.KeyRound />
                    {ga4MetricSourceMapping?.verificationStatus === "needs_reconnect" || connectedLensOAuthAccount ? "Reconnect GA4" : "Connect GA4"}
                  </a>
                </Button>
              )}
            </div>
          </SectionCard>

          {showChannelPerformance ? (
            <SectionCard
              title="Channel Performance"
              icon={<icons.BarChart3 />}
              action={
                <div className="flex flex-wrap justify-end gap-2">
                  <Badge variant="blue">Facebook</Badge>
                  <Badge variant={channelMetricsHealthVariant}>{channelMetricsHealthLabel}</Badge>
                </div>
              }
            >
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
                <Badge variant="slate">Source: {channelMetricsSource}</Badge>
                {channelMetricsUsingNativeFallback ? <Badge variant="orange">Fallback: Facebook handoff</Badge> : null}
                {channelMetricsUsingNative ? <Badge variant="blue">Native status: {nativeChannelStatus || channelMetricsHealthLabel}</Badge> : null}
                {nativeChannelPageName ? <Badge variant="slate">Page: {nativeChannelPageName}</Badge> : null}
                <Badge variant="slate">Last synced: {channelMetricsLastUpdated}</Badge>
                <Badge variant="slate">Last success: {channelMetricsLastSuccess}</Badge>
                <Badge variant={channelSyncVariant}>Sync: {channelSyncLabel}</Badge>
                <Badge variant="slate">Range: {dateRangeOptions.find((option) => option.id === dateRange)?.label}</Badge>
              </div>
              <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-600">
                {channelMetricsError
                  || (channelMetricsUsingNative
                    ? `Facebook Native is the Product-owned source for Page/channel metrics. Legacy n8n handoff remains fallback during cutover. ${channelStatusCopy(channelMetricsSnapshot?.status)}`
                    : channelMetricsUsingNativeFallback
                      ? `Native Facebook snapshots are unavailable for this view, so Product is using the legacy Facebook handoff fallback. ${channelStatusCopy(channelMetricsSnapshot?.status)}`
                      : `${channelStatusCopy(channelMetricsSnapshot?.status)} ${channelSyncStatusCopy(channelSyncStatus)}`)}
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ChannelMetricTile metric={channelMetric("facebook_views")} label="Views" size="primary" />
                <ChannelMetricTile metric={channelMetric("facebook_unique_views")} label="Unique Views Proxy" size="primary" />
                <ChannelMetricTile metric={channelMetric("facebook_engagement")} label="Engagement" size="primary" />
                <ChannelMetricTile metric={channelMetric("facebook_follower_count")} label="Followers" size="primary" />
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <ChannelMetricTile metric={channelMetric("facebook_post_count")} label="Posts" />
                <ChannelMetricTile metric={channelMetric("facebook_video_views")} label="Video Views" />
                <ChannelMetricTile metric={channelMetric("facebook_follower_growth")} label="Follower Growth" />
              </div>

              <div className="mt-4 rounded-xl border border-slate-100 bg-white px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase text-slate-400">Missing data</div>
                    <div className="mt-1 text-sm font-semibold text-slate-600">Waiting for confirmed click source from Lens or analytics.</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="slate">Link Clicks: {channelMetricDisplayValue(channelMetric("facebook_link_clicks"))}</Badge>
                    <Badge variant="slate">CTR: {channelMetricDisplayValue(channelMetric("facebook_ctr"))}</Badge>
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold leading-5 text-slate-500">
                Caveat: Reach/impressions may use Meta media view proxies. App/product metrics remain separate in cmo.app-metrics.v1.
              </div>

              {channelMetricsSnapshot?.topPosts?.length ? (
                <details className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
                  <summary className="cursor-pointer text-sm font-bold text-slate-950">Top posts</summary>
                  <div className="mt-3 grid gap-2">
                    {channelMetricsSnapshot.topPosts.slice(0, 3).map((post, index) => (
                      <div key={post.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-bold text-slate-950">Post {index + 1}</div>
                          <Badge variant="slate">{post.bucket ?? "unknown"}</Badge>
                        </div>
                        <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                          {post.messagePreview || post.postId || "No preview"}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                          <span>Views: {post.views === null || post.views === undefined ? "No data" : new Intl.NumberFormat("en-US").format(post.views)}</span>
                          <span>Engagement: {post.visibleEngagement === null || post.visibleEngagement === undefined ? "No data" : new Intl.NumberFormat("en-US").format(post.visibleEngagement)}</span>
                          <span>Rate: {post.engagementRate === null || post.engagementRate === undefined ? "No data" : `${Number(post.engagementRate.toFixed(2)).toLocaleString("en-US")}%`}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <div className="mt-3 text-xs font-semibold text-slate-500">No top posts attached to this snapshot.</div>
              )}
            </SectionCard>
          ) : null}

          {showBusinessMetrics ? (
          <SectionCard
            title="Business Metrics - Dune"
            icon={<icons.BarChart3 />}
            action={
              <div className="flex flex-wrap justify-end gap-2">
              <Badge variant="blue">Dune</Badge>
              <Badge variant={businessMetricsHealthVariant}>{businessMetricsHealthLabel}</Badge>
              </div>
            }
          >
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <Badge variant="slate">Source: {businessMetricsSourceLabel}</Badge>
              {businessMetricsUsingNativeFallback ? <Badge variant="orange">Fallback: Dune handoff</Badge> : null}
              <Badge variant={businessMetricsHealthVariant}>Status: {businessMetricsHealthLabel}</Badge>
              <Badge variant="slate">App: {app.name}</Badge>
              {(businessMetricQueryNames.length ? businessMetricQueryNames : ["holdstation_wld_aggregator_tx", "Partner Stats on WLD"]).map((queryName) => (
                <Badge key={queryName} variant="slate">Query: {queryName}</Badge>
              ))}
              <Badge variant="slate">Query IDs: {businessMetricQueryIdsForDisplay.join(", ")}</Badge>
              {businessMetricsUsingNative ? <Badge variant="blue">Native status: {nativeBusinessStatuses.length ? nativeBusinessStatuses.join(" / ") : businessMetricsHealthLabel}</Badge> : null}
              <Badge variant="slate">Last synced: {businessMetricsLastUpdated ? displayDate(businessMetricsLastUpdated) : "Not connected"}</Badge>
              <Badge variant="slate">Date range: {businessMetricDateStart && businessMetricDateEnd ? `${businessMetricDateStart} -> ${businessMetricDateEnd}` : "Not connected"}</Badge>
              <Badge variant={hasAnyBusinessMetrics ? "green" : "slate"}>Available to CMO Chat</Badge>
              <Badge variant="slate">Contract: cmo.business-metrics.v1</Badge>
            </div>

            <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-600">
              {businessMetricsError
                || (hasAnyBusinessMetrics
                  ? businessMetricsUsingNative
                    ? "Business metrics are loaded from Product native Dune snapshots. Legacy handoff remains fallback during cutover."
                    : businessMetricsUsingNativeFallback
                      ? "Native Dune snapshots are unavailable for this view, so Product is using the legacy Dune handoff fallback."
                      : "Business metrics are loaded from Dune / Worldchain handoff fallback data."
                  : "No Dune business metrics connected yet.")}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-950">WLD Aggregator Daily</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">{hasDexBusinessMetrics ? (dexBusinessMetricsSnapshot?.source.sourceId === "dune_native" ? "Loaded from Dune Native." : "Loaded from Dune handoff.") : "No data for this group yet."}</div>
                  </div>
                  <Badge variant={businessMetricStatusVariant(dexBusinessMetricsSnapshot?.status)}>{businessMetricStatusLabel(dexBusinessMetricsSnapshot?.status)}</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <BusinessMetricTile metric={dexBusinessMetric("wld_aggregator_latest_daily_tx")} label="Latest Daily Transactions" />
                  <BusinessMetricTile metric={dexBusinessMetric("wld_aggregator_cumulative_tx")} label="Cumulative Transactions" />
                  <BusinessMetricTile metric={dexBusinessMetric("wld_aggregator_latest_daily_volume_usd")} label="Latest Daily Volume" />
                  <BusinessMetricTile metric={dexBusinessMetric("wld_aggregator_cumulative_volume_usd")} label="Cumulative Volume" />
                  <BusinessMetricTile metric={dexBusinessMetric("wld_aggregator_latest_fee_usd")} label="Latest Fee Amount" />
                </div>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-950">Partner Stats</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">{hasFeesBusinessMetrics ? (feesBusinessMetricsSnapshot?.source.sourceId === "dune_native" ? "Loaded from Dune Native." : "Loaded from Dune handoff.") : "No data for this group yet."}</div>
                  </div>
                  <Badge variant={businessMetricStatusVariant(feesBusinessMetricsSnapshot?.status)}>{businessMetricStatusLabel(feesBusinessMetricsSnapshot?.status)}</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <BusinessMetricTile metric={feesBusinessMetric("wld_partner_total_volume_usd")} label="Partner Total Volume" />
                  <BusinessMetricTile metric={feesBusinessMetric("wld_partner_total_transactions")} label="Partner Total Transactions" />
                  <BusinessMetricTile metric={feesBusinessMetric("wld_partner_active_count")} label="Active Partners" />
                  <BusinessMetricTile metric={feesBusinessMetric("wld_partner_top_by_volume")} label="Top Partner by Volume" />
                  <BusinessMetricTile metric={feesBusinessMetric("wld_partner_top_by_tx")} label="Top Partner by Transactions" />
                </div>
              </div>
            </div>

            <DuneBusinessCharts
              aggregatorSnapshot={dexBusinessMetricsSnapshot}
              partnerSnapshot={feesBusinessMetricsSnapshot}
              aggregatorMode={aggregatorChartMode}
              partnerMode={partnerChartMode}
              onAggregatorModeChange={setAggregatorChartMode}
              onPartnerModeChange={setPartnerChartMode}
            />

            <div className="mt-3 rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs font-semibold leading-5 text-slate-500">
              Dune Native is the Product-owned source for business metrics. Legacy n8n handoff remains available only as fallback during cutover.
            </div>
          </SectionCard>
          ) : null}
        </div>
      ) : null}

      {activeTab === "inputs" ? (
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-5">
            <ProjectContextImportCard app={app} onImported={refreshWorkspaceAfterMemoryChange} />
          </div>

          <div className="space-y-5">
            <details className="rounded-xl border border-slate-100 bg-white p-4">
              <summary className="cursor-pointer text-sm font-bold text-slate-950">System Details</summary>
              <div className="mt-4 space-y-5">
                <ContextBriefCard brief={contextBrief} />
                <SectionCard title="Project Docs" icon={<icons.Folder />}>
                  <div className="grid gap-3 md:grid-cols-2">
                    {state.projectDocStatuses.map((status) => (
                      <div key={status.path} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-bold text-slate-950">{status.title}</div>
                          <Badge variant={status.exists ? "green" : "slate"}>{status.exists ? "exists" : "missing"}</Badge>
                        </div>
                        <div className="mt-1 break-all text-xs font-medium text-slate-500">{status.path}</div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
                <SectionCard title="App Memory" icon={<icons.Database />}>
                  <AppMemorySection appId={app.id} refreshSignal={memoryRefreshSignal} onChanged={refreshWorkspaceAfterMemoryChange} />
                </SectionCard>
              </div>
            </details>
          </div>
        </div>
      ) : null}

      {activeTab === "plan" ? (
        <div className="space-y-6">
          <Card className="p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <CardTitle>Plan & Recap Filters</CardTitle>
                <CardDescription className="mt-1">Filter reviewed outputs without exposing backend context details by default.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {dateRangeOptions.map((option) => (
                  <Button key={option.id} type="button" size="sm" variant={dateRange === option.id ? "default" : "outline"} onClick={() => setDateRange(option.id)}>
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Type">
                <select
                  value={planTypeFilter}
                  onChange={(event) => setPlanTypeFilter(event.target.value as PlanReviewTypeFilter)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                >
                  {planTypeOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={planStatusFilter}
                  onChange={(event) => setPlanStatusFilter(event.target.value as PlanReviewStatusFilter)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                >
                  {planStatusOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <SectionCard
              title="Week Plan"
              icon={<icons.FileText />}
              action={
                <Button size="sm" variant="outline" onClick={() => void createPlan("weekly")} disabled={plans.weekly.exists}>
                  <icons.Plus />
                  Create Weekly Plan
                </Button>
              }
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant={plans.weekly.exists ? "green" : "orange"}>{plans.weekly.exists ? "exists" : "missing"}</Badge>
                <Badge variant="slate">{plans.weekly.period}</Badge>
                <Badge variant="blue">{plans.weekly.status}</Badge>
              </div>
              <p className="mt-3 break-all text-sm font-medium text-slate-600">{plans.weekly.path}</p>
              {!plans.weekly.exists ? <EmptyCopy>No current week plan note exists yet.</EmptyCopy> : null}
            </SectionCard>

            <SectionCard
              title="Month Plan"
              icon={<icons.CalendarDays />}
              action={
                <Button size="sm" variant="outline" onClick={() => void createPlan("monthly")} disabled={plans.monthly.exists}>
                  <icons.Plus />
                  Create Month Plan
                </Button>
              }
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant={plans.monthly.exists ? "green" : "orange"}>{plans.monthly.exists ? "exists" : "missing"}</Badge>
                <Badge variant="slate">{plans.monthly.period}</Badge>
                <Badge variant="blue">{plans.monthly.status}</Badge>
              </div>
              <p className="mt-3 break-all text-sm font-medium text-slate-600">{plans.monthly.path}</p>
              {!plans.monthly.exists ? <EmptyCopy>No current month plan note exists yet.</EmptyCopy> : null}
            </SectionCard>
          </div>
          {planStatus ? <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{planStatus}</div> : null}
          {planError ? <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{planError}</div> : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <SectionCard title="Recap" icon={<icons.Clock3 />}>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="font-bold text-slate-950">Latest Daily Note</div>
                <div className="mt-1 break-all text-xs font-medium text-slate-500">{state.todayDailyPath}</div>
                <Badge className="mt-3" variant={state.todayDailyExists ? "green" : "orange"}>{state.todayDailyExists ? "exists" : "missing"}</Badge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <EmptyCopy>Weekly recap is not generated automatically without a reviewed plan or connected runtime.</EmptyCopy>
                <EmptyCopy>Monthly recap is not generated automatically without a reviewed plan or connected runtime.</EmptyCopy>
              </div>
            </SectionCard>

            <SectionCard title="Suggested Promotions" icon={<icons.Sparkles />}>
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <FieldValue label="Pending" value={promotionsPendingMetric?.displayValue ?? "No data"} />
                  <FieldValue label="Type filter" value={planTypeOptions.find((option) => option.id === planTypeFilter)?.label} />
                  <FieldValue label="Status filter" value={planStatusOptions.find((option) => option.id === planStatusFilter)?.label} />
                </div>
                {latestPromotion ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="font-bold text-slate-950">{latestPromotion.title}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="orange">review pending</Badge>
                      <Badge variant="slate">provenance available</Badge>
                    </div>
                  </div>
                ) : (
                  <EmptyCopy>No suggested promotion is pending for this app.</EmptyCopy>
                )}
                <details className="rounded-xl border border-slate-100 bg-white p-4">
                  <summary className="cursor-pointer text-sm font-bold text-slate-950">Advanced promotion queue</summary>
                  <div className="mt-4">
                    <PromotionCandidatesSection appId={app.id} refreshSignal={promotionRefreshSignal} onPromoted={refreshWorkspaceAfterMemoryChange} />
                  </div>
                </details>
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}

      {activeTab === "tasks" ? (
        <div className="space-y-6">
          <SectionCard title="Task Tracker Status" icon={<icons.List />}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={state.taskSummary.connected ? "green" : "orange"}>{state.taskSummary.status.replaceAll("_", " ")}</Badge>
              <Badge variant="slate">{state.taskSummary.source}</Badge>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{state.taskSummary.message}</p>
            {state.taskSummary.sourcePath ? <p className="mt-2 break-all text-xs font-medium text-slate-500">{state.taskSummary.sourcePath}</p> : null}
          </SectionCard>

          <div className="grid gap-6 xl:grid-cols-2">
            <SectionCard title="Tasks by Status" icon={<icons.CheckCircle2 />}>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Done", state.taskSummary.countsByStatus.done],
                  ["In Progress", state.taskSummary.countsByStatus.inProgress],
                  ["Need Action", state.taskSummary.countsByStatus.needAction],
                  ["Blocked", state.taskSummary.countsByStatus.blocked],
                  ["Backlog", state.taskSummary.countsByStatus.backlog],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase text-slate-400">{label}</div>
                    <div className="mt-1 text-lg font-bold text-slate-950">{count}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Tasks by Assignee" icon={<icons.Users />}>
              {state.taskSummary.assignees.length ? (
                <div className="space-y-3">
                  {state.taskSummary.assignees.map((assignee) => (
                    <div key={assignee.name} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <span className="font-bold text-slate-950">{assignee.name}</span>
                      <Badge>{assignee.count}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyCopy>Task Tracker integration is not connected yet.</EmptyCopy>
              )}
            </SectionCard>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <SectionCard title="Blockers" icon={<icons.AlertTriangle />}>
              {state.taskSummary.blockers.length ? <div className="space-y-2">{state.taskSummary.blockers.map((blocker) => <p key={blocker} className="text-sm text-slate-700">{blocker}</p>)}</div> : <EmptyCopy>No blockers from Task Tracker yet.</EmptyCopy>}
            </SectionCard>
            <SectionCard title="Tasks Created from CMO Sessions" icon={<icons.MessageSquare />}>
              <EmptyCopy>Task creation from CMO sessions is not connected yet.</EmptyCopy>
            </SectionCard>
            <SectionCard title="Vault Task Summary" icon={<icons.Database />}>
              <p className="text-sm leading-6 text-slate-600">Primary task execution lives in Task Tracker. Vault stores CMO-readable summaries, blockers, and task context only.</p>
              <p className="mt-3 break-all text-xs font-medium text-slate-500">{state.taskSummary.sourcePath}</p>
            </SectionCard>
          </div>
        </div>
      ) : null}

      {activeTab === "sessions" ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-950">{app.name} CMO Chat</h2>
              <p className="text-sm text-slate-500">Chat is the primary workspace. Hermes uses workspace context automatically.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge title={state.initialRuntimeStatus ?? "not_checked"} variant={runtimeVariant(state.initialRuntimeStatus)}>{runtimeLabel(state.initialRuntimeStatus)}</Badge>
              <Badge variant={selectedQuality.missingCount ? "orange" : "green"}>
                Vault-backed workspace context enabled
              </Badge>
              <Button type="button" size="sm" onClick={focusCurrentCmoSession}>
                <icons.MessageSquare />
                Start CMO Session
              </Button>
            </div>
          </div>

          <details className="rounded-xl border border-slate-100 bg-white p-4 xl:hidden">
            <summary className="cursor-pointer text-sm font-bold text-slate-950">Session History</summary>
            <div className="mt-3">{sessionHistoryPanel()}</div>
          </details>

          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="hidden xl:block">
              <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-100 bg-white p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-bold text-slate-950">Sessions</div>
                  <Badge variant="slate">{sessions.length}</Badge>
                </div>
                {sessionHistoryPanel()}
              </div>
            </aside>

            <main className="min-w-0">
              <CMOChatPanel
                app={app}
                contextBrief={contextBrief}
                selectedSession={selectedSession ?? null}
                onSessionCreated={(sessionId) => {
                  void refreshSessions(sessionId);
                  setPromotionRefreshSignal((current) => current + 1);
                }}
                onStartNewSession={focusCurrentCmoSession}
                initialRuntimeStatus={state.initialRuntimeStatus ?? null}
                focusSignal={sessionFocusSignal}
                activeSessionId={selectedSessionId}
              />
            </main>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <Link href="/apps">
            <icons.ChevronRight className="rotate-180" />
            Back to Apps
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/daily">
            <icons.FileText />
            Open Daily Notes
          </Link>
        </Button>
      </div>
    </PageChrome>
  );
}
