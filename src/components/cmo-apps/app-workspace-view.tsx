"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import { AppOperatingDeck } from "@/components/cmo-apps/app-operating-deck";
import { AppMemorySection } from "@/components/cmo-apps/app-memory-section";
import { CMOChatPanel } from "@/components/cmo-apps/cmo-chat-panel";
import { ContextBriefCard } from "@/components/cmo-apps/context-brief-card";
import { PromotionCandidatesSection } from "@/components/cmo-apps/promotion-candidates-section";
import type { AppWorkspaceState } from "@/lib/cmo/vault-files";
import type {
  AppPlanType,
  AppWorkspacePlanState,
  AppWorkspaceTab,
  CLevelPriority,
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
  PriorityLevel,
  PriorityStatus,
  VaultNoteRef,
} from "@/lib/cmo/app-workspace-types";
import { summarizeContextQuality } from "@/lib/cmo/context-quality";
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

function EmptyCopy({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500">{children}</div>;
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
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">{icon}</div>
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
      <span className="text-xs font-semibold uppercase text-slate-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function TextareaField({
  name,
  value,
  onChange,
  placeholder,
}: {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      name={name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
    />
  );
}

function priorityForm(priority?: CLevelPriority): CLevelPriority {
  const now = new Date().toISOString();

  return {
    id: priority?.id ?? "",
    title: priority?.title ?? "",
    source: priority?.source ?? "",
    priorityLevel: priority?.priorityLevel ?? "P1",
    timeframe: priority?.timeframe ?? "this week",
    owner: priority?.owner ?? "",
    successMetric: priority?.successMetric ?? "",
    whyNow: priority?.whyNow ?? "",
    constraints: priority?.constraints ?? "",
    mustDo: priority?.mustDo ?? "",
    mustNotDo: priority?.mustNotDo ?? "",
    status: priority?.status ?? "active",
    linkedDocs: priority?.linkedDocs ?? [],
    lastReviewedAt: priority?.lastReviewedAt ?? now,
    createdAt: priority?.createdAt ?? now,
    updatedAt: priority?.updatedAt ?? now,
  };
}

function formValue(formData: FormData, key: string, fallback: string): string {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : fallback;
}

function validPriorityLevel(value: string, fallback: PriorityLevel): PriorityLevel {
  return value === "P0" || value === "P1" || value === "P2" ? value : fallback;
}

function validPriorityStatus(value: string, fallback: PriorityStatus): PriorityStatus {
  return value === "active" || value === "paused" || value === "completed" || value === "archived" ? value : fallback;
}

function priorityFormData(form: HTMLFormElement, current: CLevelPriority): CLevelPriority {
  const formData = new FormData(form);
  const linkedDocs = formValue(formData, "linkedDocs", current.linkedDocs.join("\n"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    ...current,
    title: formValue(formData, "title", current.title),
    source: formValue(formData, "source", current.source),
    priorityLevel: validPriorityLevel(formValue(formData, "priorityLevel", current.priorityLevel), current.priorityLevel),
    timeframe: formValue(formData, "timeframe", current.timeframe),
    owner: formValue(formData, "owner", current.owner),
    successMetric: formValue(formData, "successMetric", current.successMetric),
    whyNow: formValue(formData, "whyNow", current.whyNow),
    constraints: formValue(formData, "constraints", current.constraints),
    mustDo: formValue(formData, "mustDo", current.mustDo),
    mustNotDo: formValue(formData, "mustNotDo", current.mustNotDo),
    status: validPriorityStatus(formValue(formData, "status", current.status), current.status),
    linkedDocs,
  };
}

function firstUserMessage(session: CMOChatSession): string {
  return session.messages.find((message) => message.role === "user")?.content ?? "";
}

function latestAssistantMessage(session: CMOChatSession): string {
  return [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
}

function sessionRuntimeModeLabel(session: CMOChatSession): string {
  return session.runtimeMode === "live" ? "Live" : session.isRuntimeFallback || session.isDevelopmentFallback ? "Workspace context" : "Pending";
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
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-bold text-slate-950">{displayValue}</div>
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
    <div className="min-h-28 rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
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

function StatusChipCard({
  label,
  badge,
  variant = "slate",
  detail,
}: {
  label: string;
  badge: string;
  variant?: "green" | "orange" | "red" | "blue" | "slate";
  detail?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase text-slate-400">{label}</div>
      <Badge className="mt-2" variant={variant}>{badge}</Badge>
      {detail ? <div className="mt-2 text-xs font-semibold leading-5 text-slate-500">{detail}</div> : null}
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

function metricsSourceLabel(source: CmoAppMetricsSnapshot["diagnostics"]["source"] | undefined): string {
  if (source === "json") {
    return "JSON";
  }

  if (source === "placeholder") {
    return "Placeholder";
  }

  return "Not connected";
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
    return "Lens Facebook metrics connected.";
  }

  if (status === "partial") {
    return "Some Facebook metrics are available from Lens. Link clicks and CTR are not connected yet.";
  }

  return "Lens Facebook data not normalized yet.";
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
    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white text-sm font-semibold text-slate-400">
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
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-lg border px-3 py-2 text-xs font-bold transition",
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
  const height = 286;
  const left = 54;
  const right = 34;
  const top = 28;
  const bottom = 48;
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
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={mode === "transactions" ? "Count Daily Transaction chart" : "Daily Volume in USD chart"} className="h-72 w-full">
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
              {labelIndexes.has(index) ? <text x={x} y={height - 18} textAnchor="middle" className="fill-slate-400 text-[11px] font-semibold">{shortDateLabel(point.date)}</text> : null}
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
  const height = 286;
  const left = 54;
  const right = 28;
  const top = 28;
  const bottom = 62;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxTotal = Math.max(...rows.map((row) => row.total), 1);
  const format = field === "volume" ? compactUsd : compactCount;
  const xFor = (index: number) => left + (rows.length === 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const barWidth = Math.max(10, Math.min(30, plotWidth / Math.max(rows.length, 1) * 0.52));
  const labelIndexes = new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={field === "volume" ? "Daily Partner Volume chart" : "Daily Partner Transaction Count chart"} className="h-72 w-full">
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
              {labelIndexes.has(rowIndex) ? <text x={x} y={height - 28} textAnchor="middle" className="fill-slate-400 text-[11px] font-semibold">{shortDateLabel(row.date)}</text> : null}
            </g>
          );
        })}
        <text x={left} y="18" className="fill-slate-500 text-[11px] font-bold">{field === "volume" ? "Stacked daily volume" : "Stacked daily tx"}</text>
        <text x={left} y={top + 8} className="fill-slate-400 text-[10px] font-semibold">{format(maxTotal)}</text>
      </svg>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
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
    <div className="grid gap-4 rounded-xl border border-slate-100 bg-white p-4 md:grid-cols-[220px_1fr]">
      <svg viewBox="0 0 220 220" role="img" aria-label={field === "totalVolume" ? "Partner Volume donut chart" : "Partner Transaction Count donut chart"} className="mx-auto h-56 w-56">
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
    <div className="mt-5 grid gap-4">
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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

      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
  const priorityFormRef = useRef<HTMLFormElement | null>(null);
  const [activeTab, setActiveTab] = useState<AppWorkspaceTab>(isWorkspaceTab(tabParam) ? tabParam : "dashboard");
  const [appNotes, setAppNotes] = useState<VaultNoteRef[]>(state.notes);
  const [contextBrief, setContextBrief] = useState(state.contextBrief);
  const [priorityState, setPriorityState] = useState(state.priorityState);
  const [priority, setPriority] = useState<CLevelPriority>(() => priorityForm(state.priorityState.activePriority));
  const [prioritySaveStatus, setPrioritySaveStatus] = useState<string | null>(null);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [isSavingPriority, setIsSavingPriority] = useState(false);
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
  const showChannelPerformance = app.id !== "holdstation-mini-app";
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
  const [aggregatorChartMode, setAggregatorChartMode] = useState<AggregatorChartMode>("transactions");
  const [partnerChartMode, setPartnerChartMode] = useState<PartnerChartMode>("daily_volume");
  const [planTypeFilter, setPlanTypeFilter] = useState<PlanReviewTypeFilter>("all");
  const [planStatusFilter, setPlanStatusFilter] = useState<PlanReviewStatusFilter>("pending");
  const [sessionFocusSignal, setSessionFocusSignal] = useState(0);
  const [memoryRefreshSignal, setMemoryRefreshSignal] = useState(0);
  const [promotionRefreshSignal, setPromotionRefreshSignal] = useState(0);
  const appNoteQuality = useMemo(() => summarizeContextQuality(appNotes), [appNotes]);
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
  const mostAppNotesArePlaceholders = appNoteQuality.selectedCount > 0 && appNoteQuality.placeholderCount > appNoteQuality.selectedCount / 2;
  const contextStatus = contextStatusLabel(selectedQuality);
  const memoryHealth = `${appNoteQuality.confirmedCount} confirmed / ${appNoteQuality.draftCount} draft / ${appNoteQuality.placeholderCount} need content`;
  const appLastUpdated = app.lastUpdated && app.lastUpdated !== "Vault-backed" ? app.lastUpdated : undefined;
  const lastUpdated = appLastUpdated || priorityState.activePriority?.updatedAt || latestDisplaySession?.createdAt || "Workspace context";
  const metricById = useMemo(() => {
    const lookup = new Map<string, CmoAppMetric>();

    metricsSnapshot?.metrics.forEach((metric) => lookup.set(metric.id, metric));

    return lookup;
  }, [metricsSnapshot]);
  const metricCards = [
    "activated_users",
    "activation_rate",
    "new_users",
    "d1_retention",
    "d7_retention",
    "pending_reviews",
    "promotions_pending",
  ].map((id) => metricById.get(id)).filter((metric): metric is CmoAppMetric => Boolean(metric));
  const promotionsPendingMetric = metricById.get("promotions_pending");
  const metricsHealthLabel = metricsStatus === "loading" ? "Loading" : metricStatusLabel(metricsSnapshot?.status);
  const metricsHealthVariant = metricsStatus === "loading" ? "slate" : metricStatusVariant(metricsSnapshot?.status);
  const metricsSource = metricsSourceLabel(metricsSnapshot?.diagnostics.source);
  const metricsLastUpdated = metricsSnapshot?.lastUpdatedAt ? displayDate(metricsSnapshot.lastUpdatedAt) : "Not connected";
  const channelMetricById = useMemo(() => {
    const lookup = new Map<string, CmoChannelMetric>();

    channelMetricsSnapshot?.metrics.forEach((metric) => lookup.set(metric.id, metric));

    return lookup;
  }, [channelMetricsSnapshot]);
  const channelMetric = (id: string) => channelMetricById.get(id);
  const channelMetricsHealthLabel = channelMetricsStatus === "loading" ? "Loading" : channelMetricStatusLabel(channelMetricsSnapshot?.status);
  const channelMetricsHealthVariant = channelMetricsStatus === "loading" ? "slate" : channelMetricStatusVariant(channelMetricsSnapshot?.status);
  const channelMetricsSource = channelSourceLabel(channelMetricsSnapshot?.source);
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
  const hasDexBusinessMetrics = businessSnapshotHasData(dexBusinessMetricsSnapshot);
  const hasFeesBusinessMetrics = businessSnapshotHasData(feesBusinessMetricsSnapshot);
  const hasAnyBusinessMetrics = hasDexBusinessMetrics || hasFeesBusinessMetrics;

  useEffect(() => {
    const nextTab: AppWorkspaceTab = isWorkspaceTab(tabParam) ? tabParam : "dashboard";
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
  }, [app.id]);

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

  async function refreshWorkspace() {
    const payload = await readJsonResponse<{ data: AppWorkspaceState }>(
      await fetch(`/api/apps/${app.id}/workspace`, { cache: "no-store" }),
    );

    setAppNotes(payload.data.notes);
    setContextBrief(payload.data.contextBrief);
    setPriorityState(payload.data.priorityState);
    setPriority(priorityForm(payload.data.priorityState.activePriority));
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

  async function savePriority() {
    const submittedPriority = priorityFormRef.current ? priorityFormData(priorityFormRef.current, priority) : priority;
    const requestedTitle = submittedPriority.title.trim();

    if (!requestedTitle) {
      setPriorityError("Failed: Priority title is required.");
      setPrioritySaveStatus(null);
      return;
    }

    setPriority(submittedPriority);
    setIsSavingPriority(true);
    setPrioritySaveStatus("Saving...");
    setPriorityError(null);

    try {
      const payload = await readJsonResponse<{ data: typeof priorityState & { savedPriority: CLevelPriority; updatedExisting: boolean } }>(
        await fetch(`/api/apps/${app.id}/priorities`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(submittedPriority),
        }),
      );
      const priorityReadback = await readJsonResponse<{ data: typeof priorityState }>(
        await fetch(`/api/apps/${app.id}/priorities`, { cache: "no-store" }),
      );

      if (priorityReadback.data.activePriority?.title !== requestedTitle) {
        throw new Error(`Priority saved, but readback returned "${priorityReadback.data.activePriority?.title || "none"}" instead of "${requestedTitle}".`);
      }

      setPriorityState(priorityReadback.data);
      setPriority(priorityForm(priorityReadback.data.activePriority));

      const workspace = await refreshWorkspace();

      if (workspace.priorityState.activePriority?.title !== requestedTitle) {
        throw new Error(`Workspace readback returned "${workspace.priorityState.activePriority?.title || "none"}" instead of "${requestedTitle}".`);
      }

      setPrioritySaveStatus(`Saved at ${displayDate(new Date().toISOString())}: ${payload.data.path}`);
      router.refresh();
    } catch (error) {
      setPrioritySaveStatus(null);
      setPriorityError(`Failed: ${error instanceof Error ? error.message : "C-Level priority save failed"}`);
    } finally {
      setIsSavingPriority(false);
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
      <Card className="p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={app.stage === "Active" ? "green" : "slate"}>{app.stage || "Unknown stage"}</Badge>
              <Badge title={state.initialRuntimeStatus ?? "not_checked"} variant={runtimeVariant(state.initialRuntimeStatus)}>{runtimeLabel(state.initialRuntimeStatus)}</Badge>
              <Badge variant={contextStatusVariant(contextStatus)}>Context: {contextStatus}</Badge>
              <Badge variant="slate">Workspace context enabled</Badge>
            </div>
            <h2 className="mt-3 text-xl font-bold tracking-tight text-slate-950">{app.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <span>Last updated: {displayDate(lastUpdated)}</span>
              <span>Metrics: {metricsHealthLabel}</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 xl:items-end">
            <div className="flex flex-wrap gap-2">
              {dateRangeOptions.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  size="sm"
                  variant={dateRange === option.id ? "default" : "outline"}
                  onClick={() => setDateRange(option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500">
              <input
                type="checkbox"
                checked={comparePrevious}
                onChange={(event) => setComparePrevious(event.target.checked)}
                className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Compare to previous period
            </label>
          </div>
        </div>

        {dateRange === "custom" ? (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
            Custom date range picker is not connected yet. The endpoint currently uses the current date for custom ranges unless explicit dates are supplied.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          {metricCards.map((metric) => (
            <KpiCard
              key={metric.id}
              label={metric.label}
              value={metric.status === "connected" && metric.value !== null ? metric.displayValue : "No data"}
              detail={metric.status === "connected" ? metric.description : "No metrics source connected yet."}
              muted={metric.status !== "connected"}
              status={<Badge variant={metricStatusVariant(metric.status)}>{metric.status === "connected" ? "Connected" : "Metrics missing"}</Badge>}
              comparison={comparePrevious ? metric.deltaDisplay || "No comparison data" : null}
            />
          ))}
          {!metricCards.length ? (
            <KpiCard
              label="Metrics"
              value={metricsStatus === "loading" ? "Loading" : "No data"}
              detail={metricsError || "No metrics source connected yet."}
              muted
              status={<Badge variant="orange">{metricsStatus === "error" ? "Error" : "Metrics missing"}</Badge>}
            />
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatusChipCard label="CMO" badge="Hermes Active" variant="green" detail="Product workspace ready" />
          <StatusChipCard label="Context" badge={contextStatus} variant={contextStatusVariant(contextStatus)} detail="Vault-backed workspace context enabled" />
          <StatusChipCard label="Memory" badge={memoryHealth} variant={appNoteQuality.placeholderCount ? "orange" : "green"} detail="Available to CMO" />
          <StatusChipCard label="Metrics" badge={metricsHealthLabel} variant={metricsHealthVariant} detail={`Source: ${metricsSource}; updated ${metricsLastUpdated}`} />
        </div>
      </Card>

      <Card className="p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Button key={tab.id} asChild variant={activeTab === tab.id ? "default" : "ghost"} size="sm">
              <Link href={`${pathname}?tab=${tab.id}`} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </Link>
            </Button>
          ))}
        </div>
      </Card>

      {activeTab === "dashboard" ? (
        <div className="space-y-6">
          <div className="grid gap-5 xl:grid-cols-2 2xl:grid-cols-[1.35fr_1fr_1fr_1fr]">
            <SectionCard title="Current Priority" icon={<icons.Target />}>
              {priorityState.activePriority ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge>{priorityState.activePriority.priorityLevel}</Badge>
                    <Badge variant={priorityState.activePriority.status === "active" ? "green" : "slate"}>{priorityState.activePriority.status}</Badge>
                    <Badge variant="slate">{priorityState.activePriority.timeframe}</Badge>
                  </div>
                  <div>
                    <div className="text-lg font-bold leading-7 text-slate-950">{priorityState.activePriority.title}</div>
                    {priorityState.activePriority.successMetric ? <p className="mt-2 text-sm leading-6 text-slate-700">Success metric: {priorityState.activePriority.successMetric}</p> : null}
                  </div>
                  {priorityState.activePriority.mustDo || priorityState.activePriority.mustNotDo ? (
                    <div className="grid gap-2 text-sm leading-6 text-slate-700 md:grid-cols-2">
                      {priorityState.activePriority.mustDo ? (
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                          <div className="text-xs font-bold uppercase text-emerald-700">Must do</div>
                          <div className="mt-1 text-emerald-900">{priorityState.activePriority.mustDo}</div>
                        </div>
                      ) : null}
                      {priorityState.activePriority.mustNotDo ? (
                        <div className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-2">
                          <div className="text-xs font-bold uppercase text-orange-700">Must not do</div>
                          <div className="mt-1 text-orange-900">{priorityState.activePriority.mustNotDo}</div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <EmptyCopy>No active C-Level priority yet. Add one in Inputs & Priorities.</EmptyCopy>
              )}
            </SectionCard>

            <SectionCard title="Current Mission" icon={<icons.Rocket />}>
              {app.currentMission ? <p className="text-sm leading-6 text-slate-700">{app.currentMission}</p> : <EmptyCopy>No active mission yet.</EmptyCopy>}
            </SectionCard>

            <SectionCard title="KPI / Metrics Snapshot" icon={<icons.BarChart3 />}>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={metricsHealthVariant}>Metrics: {metricsHealthLabel}</Badge>
                  <Badge variant="slate">Source: {metricsSource}</Badge>
                  <Badge variant="slate">Range: {dateRangeOptions.find((option) => option.id === dateRange)?.label}</Badge>
                </div>
                <EmptyCopy>{metricsSnapshot?.diagnostics.notes[0] ?? "No metrics source connected yet."}</EmptyCopy>
              </div>
            </SectionCard>

            <SectionCard title="Task Summary" icon={<icons.List />}>
              <EmptyCopy>{state.taskSummary.message}</EmptyCopy>
            </SectionCard>
          </div>

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
                <Badge variant="slate">Last synced: {channelMetricsLastUpdated}</Badge>
                <Badge variant="slate">Last success: {channelMetricsLastSuccess}</Badge>
                <Badge variant={channelSyncVariant}>Sync: {channelSyncLabel}</Badge>
                <Badge variant="slate">Range: {dateRangeOptions.find((option) => option.id === dateRange)?.label}</Badge>
              </div>
              <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-600">
                {channelMetricsError || `${channelStatusCopy(channelMetricsSnapshot?.status)} ${channelSyncStatusCopy(channelSyncStatus)}`}
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
              <Badge variant="slate">Source: Dune / Worldchain</Badge>
              <Badge variant="slate">App: Holdstation Wallet Miniapp</Badge>
              <Badge variant="slate">Query: holdstation_wld_aggregator_tx</Badge>
              <Badge variant="slate">Query: Partner Stats on WLD</Badge>
              <Badge variant="slate">Last updated: {businessMetricsLastUpdated ? displayDate(businessMetricsLastUpdated) : "Not connected"}</Badge>
              <Badge variant={hasAnyBusinessMetrics ? "green" : "slate"}>Available to CMO Chat</Badge>
              <Badge variant="slate">Contract: cmo.business-metrics.v1</Badge>
            </div>

            <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-600">
              {businessMetricsError
                || (hasAnyBusinessMetrics
                  ? "Business metrics are loaded from normalized Dune / Worldchain handoff JSON. Dune is authoritative for Holdstation Mini App metrics."
                  : "No Dune business metrics connected yet.")}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-950">WLD Aggregator Daily</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">{hasDexBusinessMetrics ? "Loaded from Dune handoff." : "No data for this group yet."}</div>
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
                    <div className="mt-1 text-xs font-semibold text-slate-500">{hasFeesBusinessMetrics ? "Loaded from Dune handoff." : "No data for this group yet."}</div>
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
              Dune / Worldchain JSON files remain the machine-readable source of truth. n8n exports Dune data into CMO, CMO does not call Dune directly, and deprecated DefiLlama data is not used for Mini App metric answers.
            </div>
          </SectionCard>

          <div className="grid gap-5 xl:grid-cols-3">
            <SectionCard title="Week Plan Summary" icon={<icons.CalendarDays />}>
              {plans.weekly.exists ? (
                <div>
                  <Badge variant="blue">{plans.weekly.status}</Badge>
                  <p className="mt-3 break-all text-sm font-medium text-slate-600">{plans.weekly.path}</p>
                </div>
              ) : (
                <EmptyCopy>No active weekly plan yet.</EmptyCopy>
              )}
            </SectionCard>

            <SectionCard title="Latest CMO Session" icon={<icons.MessageSquare />}>
              {latestDisplaySession ? (
                <div className="space-y-3">
                  <div className="font-bold text-slate-950">{latestDisplaySession.topic || "CMO session"}</div>
                  <div className="flex flex-wrap gap-2">
                    <Badge title={latestDisplaySession.runtimeStatus} variant={runtimeVariant(latestDisplaySession.runtimeStatus)}>{runtimeLabel(latestDisplaySession.runtimeStatus)}</Badge>
                    <Badge variant={latestDisplaySession.runtimeMode === "live" ? "green" : "orange"}>{sessionRuntimeModeLabel(latestDisplaySession)}</Badge>
                  </div>
                  <CardDescription>{displayDate(latestDisplaySession.createdAt)}</CardDescription>
                </div>
              ) : (
                <EmptyCopy>No CMO session saved yet.</EmptyCopy>
              )}
            </SectionCard>

            <SectionCard title="Latest Recap" icon={<icons.FileText />}>
              {state.todayDailyExists ? (
                <div>
                  <Badge variant="green">Daily note exists</Badge>
                  <p className="mt-3 break-all text-sm font-medium text-slate-600">{state.todayDailyPath}</p>
                </div>
              ) : (
                <EmptyCopy>No daily recap exists for today.</EmptyCopy>
              )}
            </SectionCard>
          </div>

          <SectionCard title="CMO Readiness / Data Quality" icon={<icons.ShieldCheck />}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase text-slate-400">Runtime</div>
                <Badge className="mt-2" title={state.initialRuntimeStatus ?? "not_checked"} variant={runtimeVariant(state.initialRuntimeStatus)}>{runtimeLabel(state.initialRuntimeStatus)}</Badge>
                {state.initialRuntimeStatus === "configured_but_unreachable" ? <p className="mt-2 text-xs font-medium text-slate-500">Workspace context is available.</p> : null}
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase text-slate-400">Memory</div>
                <div className="mt-2 text-sm font-bold text-slate-950">
                  {appNoteQuality.confirmedCount} confirmed / {appNoteQuality.draftCount} draft / {appNoteQuality.placeholderCount} need content
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase text-slate-400">Metrics</div>
                <Badge className="mt-2" variant={metricsHealthVariant}>{metricsHealthLabel}</Badge>
                <div className="mt-2 text-xs font-semibold text-slate-500">Source: {metricsSource}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase text-slate-400">C-Level Priority</div>
                <Badge className="mt-2" variant={priorityState.activePriority ? "green" : "orange"}>{priorityState.activePriority ? "active" : "missing"}</Badge>
              </div>
            </div>
          </SectionCard>

          <details className="rounded-xl border border-slate-100 bg-white p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-950">System Details</summary>
            <div className="mt-4 space-y-5">
              <ContextBriefCard brief={contextBrief} />
              <AppOperatingDeck
                app={app}
                notes={appNotes}
                recentCaptures={state.recentCaptures}
                dailyNotePath={state.todayDailyPath}
                dailyNoteExists={state.todayDailyExists}
                latestPromotion={latestPromotion}
              />
            </div>
          </details>
        </div>
      ) : null}

      {activeTab === "inputs" ? (
        <div className="grid gap-6 2xl:grid-cols-[1fr_0.9fr]">
          <div className="space-y-6">
            <SectionCard title="Priority Snapshot" icon={<icons.Target />} action={<Badge variant={priorityState.activePriority ? "green" : "orange"}>{priorityState.activePriority ? "active" : "missing"}</Badge>}>
              <div className="grid gap-3 md:grid-cols-2">
                <FieldValue label="Current priority" value={priorityState.activePriority?.title} />
                <FieldValue label="Why now" value={priorityState.activePriority?.whyNow} />
                <FieldValue label="Success metric" value={priorityState.activePriority?.successMetric} />
                <FieldValue label="Timeframe" value={priorityState.activePriority?.timeframe} />
                <FieldValue label="Owner" value={priorityState.activePriority?.owner} />
                <FieldValue label="Last updated" value={displayDate(priorityState.activePriority?.updatedAt)} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="slate">Source: {priorityState.activePriority?.source || "Updated via CMO Chat / Manual"}</Badge>
                {priorityState.activePriority ? <Badge>{priorityState.activePriority.priorityLevel}</Badge> : null}
                {priorityState.activePriority ? <Badge variant={priorityState.activePriority.status === "active" ? "green" : "slate"}>{priorityState.activePriority.status}</Badge> : null}
              </div>
              {priorityState.priorities.length > 1 ? (
                <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-bold uppercase text-slate-400">Priority Change Log</div>
                  <div className="mt-3 space-y-2">
                    {priorityState.priorities.slice(0, 4).map((item) => (
                      <div key={item.id || `${item.title}-${item.updatedAt}`} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <span className="font-semibold text-slate-800">{item.title || "Untitled priority"}</span>
                        <span className="text-xs font-semibold text-slate-500">{displayDate(item.updatedAt)} - {item.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <details className="mt-5 rounded-xl border border-slate-100 bg-white p-4">
                <summary className="cursor-pointer text-sm font-bold text-slate-950">Edit manually</summary>
                <form
                ref={priorityFormRef}
                onSubmit={(event) => {
                  event.preventDefault();
                  void savePriority();
                }}
              >
                {priorityState.activePriority ? (
                  <div className="mb-5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="green">Active priority</Badge>
                      <Badge>{priorityState.activePriority.priorityLevel}</Badge>
                      <Badge variant="slate">{priorityState.activePriority.timeframe}</Badge>
                    </div>
                    <div className="mt-2 font-bold text-emerald-950">{priorityState.activePriority.title}</div>
                    {priorityState.activePriority.successMetric ? <div className="mt-1 text-sm font-medium text-emerald-800">Success metric: {priorityState.activePriority.successMetric}</div> : null}
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Title">
                    <Input name="title" required value={priority.title} onChange={(event) => setPriority((current) => ({ ...current, title: event.target.value }))} placeholder="Executive priority title" />
                    <p className="mt-1 text-xs font-medium text-slate-500">Required for save and dashboard readback.</p>
                  </Field>
                  <Field label="Source">
                    <Input name="source" value={priority.source} onChange={(event) => setPriority((current) => ({ ...current, source: event.target.value }))} placeholder="CEO, leadership review, planning note" />
                  </Field>
                  <Field label="Priority Level">
                    <select
                      name="priorityLevel"
                      value={priority.priorityLevel}
                      onChange={(event) => setPriority((current) => ({ ...current, priorityLevel: event.target.value as PriorityLevel }))}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                    >
                      <option value="P0">P0</option>
                      <option value="P1">P1</option>
                      <option value="P2">P2</option>
                    </select>
                  </Field>
                  <Field label="Timeframe">
                    <Input name="timeframe" value={priority.timeframe} onChange={(event) => setPriority((current) => ({ ...current, timeframe: event.target.value }))} placeholder="this week, this month, this quarter, custom" />
                  </Field>
                  <Field label="Owner">
                    <Input name="owner" value={priority.owner} onChange={(event) => setPriority((current) => ({ ...current, owner: event.target.value }))} placeholder="Owner" />
                  </Field>
                  <Field label="Status">
                    <select
                      name="status"
                      required
                      value={priority.status}
                      onChange={(event) => setPriority((current) => ({ ...current, status: event.target.value as PriorityStatus }))}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                    >
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                      <option value="completed">completed</option>
                      <option value="archived">archived</option>
                    </select>
                    <p className="mt-1 text-xs font-medium text-slate-500">Required. Use active for the current C-Level priority.</p>
                  </Field>
                </div>
                <div className="mt-4 grid gap-4">
                  <Field label="Success Metric">
                    <Input name="successMetric" value={priority.successMetric} onChange={(event) => setPriority((current) => ({ ...current, successMetric: event.target.value }))} placeholder="Metric or outcome to watch" />
                  </Field>
                  <Field label="Why Now">
                    <TextareaField name="whyNow" value={priority.whyNow} onChange={(value) => setPriority((current) => ({ ...current, whyNow: value }))} />
                  </Field>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Constraints">
                      <TextareaField name="constraints" value={priority.constraints} onChange={(value) => setPriority((current) => ({ ...current, constraints: value }))} />
                    </Field>
                    <Field label="Linked Docs">
                      <TextareaField name="linkedDocs" value={priority.linkedDocs.join("\n")} onChange={(value) => setPriority((current) => ({ ...current, linkedDocs: value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) }))} />
                    </Field>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Must Do">
                      <TextareaField name="mustDo" value={priority.mustDo} onChange={(value) => setPriority((current) => ({ ...current, mustDo: value }))} />
                    </Field>
                    <Field label="Must Not Do">
                      <TextareaField name="mustNotDo" value={priority.mustNotDo} onChange={(value) => setPriority((current) => ({ ...current, mustNotDo: value }))} />
                    </Field>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button type="submit" disabled={isSavingPriority}>
                    {isSavingPriority ? <icons.RefreshCw className="animate-spin" /> : <icons.Check />}
                    Save Priority
                  </Button>
                  <CardDescription className="break-all">{priorityState.path}</CardDescription>
                </div>
                {prioritySaveStatus ? <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{prioritySaveStatus}</div> : null}
                {priorityError ? <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{priorityError}</div> : null}
                </form>
              </details>
            </SectionCard>

            <SectionCard title="Memory Health" icon={<icons.Database />}>
              <div className="grid gap-3 md:grid-cols-4">
                <FieldValue label="Confirmed" value={appNoteQuality.confirmedCount} />
                <FieldValue label="Draft" value={appNoteQuality.draftCount} />
                <FieldValue label="Needs input" value={appNoteQuality.placeholderCount} />
                <FieldValue label="Last updated" value={displayDate(lastUpdated)} />
              </div>
              {mostAppNotesArePlaceholders ? <p className="mt-3 text-sm font-medium text-orange-700">Memory quality is partial. Use CMO Chat to clarify durable facts before promotion.</p> : null}
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard title="Backend Status" icon={<icons.ShieldCheck />}>
              <div className="grid gap-3">
                <StatusChipCard label="Context" badge={contextStatus} variant={contextStatusVariant(contextStatus)} detail="Resolved automatically" />
                <StatusChipCard label="Memory" badge={memoryHealth} variant={appNoteQuality.placeholderCount ? "orange" : "green"} detail="Backend managed" />
                <StatusChipCard label="Metrics" badge={metricsHealthLabel} variant={metricsHealthVariant} detail={`Source: ${metricsSource}; updated ${metricsLastUpdated}`} />
              </div>
            </SectionCard>

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
