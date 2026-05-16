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
  CMOChatMessage,
  CMOChatSession,
  CMORuntimeStatus,
  CmoAssumptionReviewStatus,
  CmoDecisionReviewStatus,
  CmoMemoryCandidateReviewStatus,
  CmoSuggestedActionReviewStatus,
  CmoTaskCandidateReviewStatus,
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
  if (status === "connected") {
    return "Adapter connected";
  }

  if (status === "live") {
    return "Live app-chat";
  }

  if (status === "configured_but_unreachable") {
    return "Live app-chat unavailable";
  }

  if (status === "live_failed_then_fallback") {
    return "Fallback used";
  }

  if (status === "development_fallback") {
    return "Development fallback";
  }

  if (status === "runtime_error") {
    return "Runtime error";
  }

  if (status === "not_configured") {
    return "Runtime not configured";
  }

  return "Runtime not checked";
}

function runtimeVariant(status: CMORuntimeStatus | undefined): "green" | "orange" | "red" | "slate" {
  if (status === "connected" || status === "live") {
    return "green";
  }

  if (status === "configured_but_unreachable" || status === "runtime_error") {
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

function sessionPotentialDecisions(session: CMOChatSession | undefined): string[] {
  const answer = [...(session?.messages ?? [])].reverse().find((message) => message.role === "assistant")?.content ?? "";

  return answer
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter((line) => /decision|approve|choose|commit/i.test(line))
    .slice(0, 5);
}

function sessionContextSummary(session: CMOChatSession): string {
  const quality = session.contextQualitySummary;

  if (!quality) {
    return `${session.contextUsed.length} notes`;
  }

  return `${quality.confirmedCount} confirmed, ${quality.draftCount} draft, ${quality.placeholderCount} need content, ${quality.missingCount} missing`;
}

function firstUserMessage(session: CMOChatSession): string {
  return session.messages.find((message) => message.role === "user")?.content ?? "";
}

function latestAssistantMessage(session: CMOChatSession): string {
  return [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
}

function previewText(value: string, limit = 160): string {
  const compact = value.replace(/\s+/g, " ").trim();

  return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

function sessionRuntimeModeLabel(session: CMOChatSession): string {
  return session.runtimeMode === "live" ? "live" : session.isRuntimeFallback || session.isDevelopmentFallback ? "fallback used" : "runtime pending";
}

function assistantMessageProvenance(message: CMOChatMessage, session: CMOChatSession): string | null {
  if (message.role !== "assistant") {
    return null;
  }

  const mode = message.runtimeMode ?? session.runtimeMode;

  if (!mode) {
    return null;
  }

  const runtime = mode === "live" ? "Live" : "Fallback";
  const provider = mode === "live"
    ? message.runtimeAgent || session.runtimeAgent || message.runtimeProvider || session.runtimeProvider || "OpenClaw CMO"
    : `reason: ${message.runtimeErrorReason ?? session.runtimeErrorReason ?? "fallback"}`;

  return `${runtime} · ${provider} · ${message.contextUsedCount ?? session.contextUsed.length} context notes`;
}

type DecisionLayerReviewItemType = "decision" | "assumption" | "suggestedAction" | "memoryCandidate" | "taskCandidate";
type DecisionLayerReviewStatus =
  | CmoDecisionReviewStatus
  | CmoAssumptionReviewStatus
  | CmoSuggestedActionReviewStatus
  | CmoMemoryCandidateReviewStatus
  | CmoTaskCandidateReviewStatus;
type SessionFilter = "all" | "live" | "fallback" | "saved" | "raw";
type ContextDrawerTab = "context" | "decision" | "metadata" | "vault";
type PlanReviewTypeFilter = "all" | "decisions" | "tasks" | "memory";
type PlanReviewStatusFilter = "pending" | "approved" | "skipped";

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

function reviewBadgeVariant(status: string | undefined): "green" | "orange" | "red" | "blue" | "slate" {
  if (status === "confirmed" || status === "accepted" || status === "reviewed" || status === "approved_for_promotion_later" || status === "approved_for_task_later") {
    return "green";
  }

  if (status === "rejected") {
    return "red";
  }

  if (status === "deferred" || status === "risky" || status === "review_required") {
    return "orange";
  }

  return "slate";
}

function reviewLabel(status: string | undefined): string {
  return status?.replace(/_/g, " ") ?? "unreviewed";
}

function decisionLayerStatus(session: CMOChatSession | undefined): {
  total: number;
  reviewed: number;
  pending: number;
  suggestedActions: number;
  memoryCandidates: number;
  taskCandidates: number;
  deferred: number;
  approvedForLater: number;
} {
  const layer = session?.decisionLayer;

  if (!layer) {
    return {
      total: 0,
      reviewed: 0,
      pending: 0,
      suggestedActions: 0,
      memoryCandidates: 0,
      taskCandidates: 0,
      deferred: 0,
      approvedForLater: 0,
    };
  }

  const statuses = [
    ...layer.decisions.map((item) => item.reviewStatus ?? "unreviewed"),
    ...layer.assumptions.map((item) => item.reviewStatus ?? "unreviewed"),
    ...layer.suggestedActions.map((item) => item.reviewStatus ?? "unreviewed"),
    ...layer.memoryCandidates.map((item) => item.reviewStatus),
    ...layer.taskCandidates.map((item) => item.reviewStatus ?? "unreviewed"),
  ];

  return {
    total: statuses.length,
    reviewed: statuses.filter((status) => status !== "unreviewed" && status !== "review_required").length,
    pending: statuses.filter((status) => status === "unreviewed" || status === "review_required").length,
    suggestedActions: layer.suggestedActions.length,
    memoryCandidates: layer.memoryCandidates.length,
    taskCandidates: layer.taskCandidates.length,
    deferred: statuses.filter((status) => status === "deferred").length,
    approvedForLater: statuses.filter((status) => status === "approved_for_promotion_later" || status === "approved_for_task_later").length,
  };
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

  if (filter === "fallback") {
    return session.runtimeMode !== "live" || session.isRuntimeFallback === true || session.isDevelopmentFallback === true;
  }

  if (filter === "saved") {
    return session.savedToVault === true;
  }

  return Boolean(session.rawCapturePath);
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(state.latestSessions[0]?.id ?? null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isSavingSelectedSession, setIsSavingSelectedSession] = useState(false);
  const [isCapturingSelectedSession, setIsCapturingSelectedSession] = useState(false);
  const [reviewingDecisionItemId, setReviewingDecisionItemId] = useState<string | null>(null);
  const [decisionReviewStatus, setDecisionReviewStatus] = useState<string | null>(null);
  const [decisionReviewError, setDecisionReviewError] = useState<string | null>(null);
  const [showAdvancedDecisionControls, setShowAdvancedDecisionControls] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [contextDrawerOpen, setContextDrawerOpen] = useState(true);
  const [contextDrawerTab, setContextDrawerTab] = useState<ContextDrawerTab>("decision");
  const [dateRange, setDateRange] = useState<CmoAppMetricDateRangePreset>("this_week");
  const [comparePrevious, setComparePrevious] = useState(false);
  const [metricsSnapshot, setMetricsSnapshot] = useState<CmoAppMetricsSnapshot | null>(null);
  const [metricsStatus, setMetricsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [planTypeFilter, setPlanTypeFilter] = useState<PlanReviewTypeFilter>("all");
  const [planStatusFilter, setPlanStatusFilter] = useState<PlanReviewStatusFilter>("pending");
  const [sessionFocusSignal, setSessionFocusSignal] = useState(0);
  const [memoryRefreshSignal, setMemoryRefreshSignal] = useState(0);
  const [promotionRefreshSignal, setPromotionRefreshSignal] = useState(0);
  const appNoteQuality = useMemo(() => summarizeContextQuality(appNotes), [appNotes]);
  const selectedQuality = contextBrief.contextQualitySummary;
  const selectedSession = selectedSessionId ? sessions.find((session) => session.id === selectedSessionId) : undefined;
  const selectedDecisionStatus = decisionLayerStatus(selectedSession);
  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();

    return sessions.filter((session) => {
      const searchable = [
        session.topic,
        firstUserMessage(session),
        latestAssistantMessage(session),
      ].join(" ").toLowerCase();

      return matchesSessionFilter(session, sessionFilter) && (!query || searchable.includes(query));
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
  const mostAppNotesArePlaceholders = appNoteQuality.selectedCount > 0 && appNoteQuality.placeholderCount > appNoteQuality.selectedCount / 2;
  const contextStatus = contextStatusLabel(selectedQuality);
  const memoryHealth = `${appNoteQuality.confirmedCount} confirmed / ${appNoteQuality.draftCount} draft / ${appNoteQuality.placeholderCount} need content`;
  const sourceStatus = state.todayRawExists || selectedSession?.rawCapturePath ? "Exists" : "Missing";
  const lastUpdated = app.lastUpdated || priorityState.activePriority?.updatedAt || latestSession?.createdAt || "Vault-backed";
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

  function selectTab(tab: AppWorkspaceTab, hash?: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", tab);
    const target = `${pathname}?${next.toString()}${hash ? `#${hash}` : ""}`;

    setActiveTab(tab);

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", target);
    }

    router.replace(target, { scroll: false });
  }

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

      return current === null ? null : payload.data[0]?.id ?? null;
    });
    return payload.data;
  }

  function focusCurrentCmoSession() {
    setActiveTab("sessions");
    setSelectedSessionId(null);
    setSessionFocusSignal((current) => current + 1);
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

  async function saveSelectedSessionToVault() {
    if (!selectedSession || isSavingSelectedSession) {
      return;
    }

    setIsSavingSelectedSession(true);
    setSessionStatus("Saving session...");
    setSessionError(null);

    try {
      const response = await readJsonResponse<{ path: string; alreadySaved: boolean }>(
        await fetch("/api/cmo/sessions/save-to-vault", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appId: app.id,
            sessionId: selectedSession.id,
            topic: selectedSession.topic,
            relatedPriority: priorityState.activePriority?.title,
          }),
        }),
      );

      setSessionStatus(`${response.alreadySaved ? "Already saved" : "Saved to Vault"}: ${response.path}`);
      await refreshSessions(selectedSession.id);
      setPromotionRefreshSignal((current) => current + 1);
    } catch (error) {
      setSessionStatus(null);
      setSessionError(`Failed to save: ${error instanceof Error ? error.message : "Session save failed"}`);
    } finally {
      setIsSavingSelectedSession(false);
    }
  }

  async function captureSelectedSessionToRawVault() {
    if (!selectedSession || selectedSession.rawCapturePath || isCapturingSelectedSession) {
      return;
    }

    setIsCapturingSelectedSession(true);
    setSessionStatus("Capturing...");
    setSessionError(null);

    try {
      const topic = selectedSession.topic || "CMO session";
      const assistantAnswer = [...selectedSession.messages].reverse().find((message) => message.role === "assistant")?.content ?? "No CMO answer captured.";
      const userInputs = selectedSession.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");

      const response = await readJsonResponse<{ path: string }>(
        await fetch("/api/vault/raw-captures", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: "holdstation",
            appId: app.id,
            appName: app.name,
            topic,
            source: "cmo-session",
            relatedSource: "cmo-session",
            sessionId: selectedSession.id,
            sessionNotePath: selectedSession.sessionNotePath,
            relatedPriority: priorityState.activePriority?.title,
            relatedPlan: plans.weekly.exists ? plans.weekly.path : undefined,
            summary: [
              `CMO session for ${app.name}.`,
              `Runtime: ${selectedSession.runtimeStatus ?? "not captured"}.`,
              `Runtime mode: ${selectedSession.runtimeMode ?? "not captured"}.`,
              `Attempted runtime mode: ${selectedSession.attemptedRuntimeMode ?? "not captured"}.`,
              `Fallback: ${selectedSession.isDevelopmentFallback ? "true" : "false"}.`,
              `Runtime fallback: ${selectedSession.isRuntimeFallback ? "true" : "false"}.`,
              `Runtime error reason: ${selectedSession.runtimeErrorReason ?? "none"}.`,
              `Runtime provider: ${selectedSession.runtimeProvider ?? "not captured"}.`,
              `Runtime agent: ${selectedSession.runtimeAgent ?? "not captured"}.`,
              `Context quality: ${sessionContextSummary(selectedSession)}.`,
              `Graph status: ${selectedSession.graphStatus ?? "empty"}.`,
              `Graph hints used: ${selectedSession.graphHintCount ?? selectedSession.graphHints?.length ?? 0}.`,
              selectedSession.graphHints?.length
                ? `Graph hint refs: ${selectedSession.graphHints.map((hint) => `${hint.title} (${hint.path})`).join(", ")}.`
                : "Graph hint refs: none.",
              selectedSession.decisionLayer
                ? `Decision layer: ${selectedSession.decisionLayer.decisions.length} decisions, ${selectedSession.decisionLayer.assumptions.length} assumptions, ${selectedSession.decisionLayer.suggestedActions.length} actions, ${selectedSession.decisionLayer.memoryCandidates.length} memory candidates, ${selectedSession.decisionLayer.taskCandidates.length} task candidates.`
                : "Decision layer: not extracted.",
              selectedSession.sessionNotePath ? `Full session note: ${selectedSession.sessionNotePath}.` : "Full session note not saved yet.",
            ].join("\n"),
            selectedContextNotes: [...selectedSession.contextUsed, ...(selectedSession.missingContext ?? [])],
            graphHints: selectedSession.graphHints,
            graphHintCount: selectedSession.graphHintCount,
            graphStatus: selectedSession.graphStatus,
            decisionLayer: selectedSession.decisionLayer,
            messages: selectedSession.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            contextUsed: selectedSession.contextUsed,
            missingContext: selectedSession.missingContext,
            runtimeStatus: selectedSession.runtimeStatus,
            runtimeMode: selectedSession.runtimeMode,
            attemptedRuntimeMode: selectedSession.attemptedRuntimeMode,
            isDevelopmentFallback: selectedSession.isDevelopmentFallback,
            isRuntimeFallback: selectedSession.isRuntimeFallback,
            runtimeErrorReason: selectedSession.runtimeErrorReason,
            runtimeProvider: selectedSession.runtimeProvider,
            runtimeAgent: selectedSession.runtimeAgent,
            contextDiagnostics: selectedSession.contextDiagnostics,
            contextQualitySummary: selectedSession.contextQualitySummary,
            assumptions: selectedSession.assumptions,
            suggestedActions: selectedSession.suggestedActions,
            openQuestions: userInputs ? [`Review user input: ${userInputs.slice(0, 160)}`] : [],
          }),
        }),
      );

      setSessionStatus(`Captured to Raw Vault: ${response.path}. CMO answer included: ${assistantAnswer ? "yes" : "no"}.`);
      await refreshSessions(selectedSession.id);
      setPromotionRefreshSignal((current) => current + 1);
    } catch (error) {
      setSessionStatus(null);
      setSessionError(`Failed to capture: ${error instanceof Error ? error.message : "Raw capture failed"}`);
    } finally {
      setIsCapturingSelectedSession(false);
    }
  }

  async function reviewDecisionLayerItem(itemType: DecisionLayerReviewItemType, itemId: string, reviewStatus: DecisionLayerReviewStatus) {
    if (!selectedSession || reviewingDecisionItemId) {
      return;
    }

    setReviewingDecisionItemId(itemId);
    setDecisionReviewStatus(null);
    setDecisionReviewError(null);

    try {
      const payload = await readJsonResponse<{ data: CMOChatSession }>(
        await fetch("/api/cmo/sessions/decision-layer/review", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appId: app.id,
            sessionId: selectedSession.id,
            itemType,
            itemId,
            reviewStatus,
          }),
        }),
      );

      setSessions((current) => current.map((session) => (session.id === payload.data.id ? payload.data : session)));
      setSelectedSessionId(payload.data.id);
      setDecisionReviewStatus(`Review saved: ${reviewLabel(reviewStatus)}.`);
      setPromotionRefreshSignal((current) => current + 1);
    } catch (error) {
      setDecisionReviewError(error instanceof Error ? error.message : "Decision review update failed");
    } finally {
      setReviewingDecisionItemId(null);
    }
  }

  function sessionHistoryPanel() {
    const filters: Array<{ id: SessionFilter; label: string }> = [
      { id: "all", label: "All" },
      { id: "live", label: "Live" },
      { id: "fallback", label: "Fallback" },
      { id: "saved", label: "Saved" },
      { id: "raw", label: "Raw" },
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
                      <Badge variant={session.runtimeMode === "live" || session.runtimeStatus === "live" ? "green" : "orange"}>{session.runtimeMode === "live" || session.runtimeStatus === "live" ? "Live" : "Fallback"}</Badge>
                      <Badge variant={sessionOutputCount(session) ? "blue" : "slate"}>{sessionOutputCount(session)} outputs</Badge>
                      {session.savedToVault ? <Badge variant="green">saved</Badge> : null}
                      {session.rawCapturePath ? <Badge variant="green">raw</Badge> : null}
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
    <Button asChild>
      <Link
        href={`${pathname}?tab=sessions#cmo-session`}
        onClick={focusCurrentCmoSession}
      >
        <icons.MessageSquare />
        Start CMO Session
      </Link>
    </Button>
  );

  return (
    <PageChrome title={app.name} description="Executive app workspace with chat-first CMO review, status, and Vault provenance." actions={headerActions}>
      <Card className="p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={app.stage === "Active" ? "green" : "slate"}>{app.stage || "Unknown stage"}</Badge>
              <Badge title={state.initialRuntimeStatus ?? "not_checked"} variant={runtimeVariant(state.initialRuntimeStatus)}>{runtimeLabel(state.initialRuntimeStatus)}</Badge>
              <Badge variant={contextStatusVariant(contextStatus)}>Context: {contextStatus}</Badge>
              <Badge variant="slate">Source: Vault-backed</Badge>
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatusChipCard label="Context" badge={contextStatus} variant={contextStatusVariant(contextStatus)} detail={`${selectedQuality.existingCount}/${selectedQuality.selectedCount} source checks`} />
          <StatusChipCard label="Memory" badge={memoryHealth} variant={appNoteQuality.placeholderCount ? "orange" : "green"} detail="Backend managed" />
          <StatusChipCard label="Metrics" badge={metricsHealthLabel} variant={metricsHealthVariant} detail={`Source: ${metricsSource}; updated ${metricsLastUpdated}`} />
          <StatusChipCard label="Vault" badge="Backed" variant="green" detail="App-scoped source" />
          <StatusChipCard label="Raw" badge={sourceStatus} variant={sourceStatus === "Exists" ? "green" : "orange"} detail="Capture provenance" />
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
              {latestSession ? (
                <div className="space-y-3">
                  <div className="font-bold text-slate-950">{latestSession.topic || "CMO session"}</div>
                  <div className="flex flex-wrap gap-2">
                    <Badge title={latestSession.runtimeStatus} variant={runtimeVariant(latestSession.runtimeStatus)}>{runtimeLabel(latestSession.runtimeStatus)}</Badge>
                    <Badge variant={latestSession.runtimeMode === "live" ? "green" : "orange"}>{sessionRuntimeModeLabel(latestSession)}</Badge>
                  </div>
                  <CardDescription>{displayDate(latestSession.createdAt)}</CardDescription>
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
                {state.initialRuntimeStatus === "configured_but_unreachable" ? <p className="mt-2 text-xs font-medium text-slate-500">CMO runtime is not connected yet. Using development fallback.</p> : null}
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
              <p className="text-sm text-slate-500">Chat is the primary workspace. Context, review state, and Vault provenance stay in the side drawer.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge title={state.initialRuntimeStatus ?? "not_checked"} variant={runtimeVariant(state.initialRuntimeStatus)}>{runtimeLabel(state.initialRuntimeStatus)}</Badge>
              <Badge variant={selectedQuality.missingCount ? "orange" : "green"}>
                Context {selectedQuality.existingCount}/{selectedQuality.selectedCount}
              </Badge>
              <Button type="button" size="sm" variant="outline" onClick={() => setContextDrawerOpen((current) => !current)}>
                {contextDrawerOpen ? <icons.ChevronRight /> : <icons.ChevronDown />}
                Context Drawer
              </Button>
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

          <div className={cn("grid gap-4", contextDrawerOpen ? "xl:grid-cols-[280px_minmax(0,1fr)_360px]" : "xl:grid-cols-[280px_minmax(0,1fr)]")}>
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
                onSessionSaved={() => {
                  void refreshSessions();
                  setPromotionRefreshSignal((current) => current + 1);
                }}
                initialRuntimeStatus={state.initialRuntimeStatus ?? null}
                initialRuntimeLabel={state.initialRuntimeLabel ?? ""}
                focusSignal={sessionFocusSignal}
                relatedPriority={priorityState.activePriority?.title}
                activeSessionId={selectedSessionId}
              />
            </main>

            {contextDrawerOpen ? (
              <aside className="min-w-0">
                <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-100 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-slate-950">Context Drawer</div>
                      <div className="text-xs font-medium text-slate-500">Status, provenance, and review tracking</div>
                    </div>
                    <Button type="button" size="icon" variant="ghost" onClick={() => setContextDrawerOpen(false)} title="Collapse context drawer">
                      <icons.ChevronRight />
                    </Button>
                  </div>
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    {[
                      ["context", "Context"],
                      ["decision", "Decision"],
                      ["metadata", "Metadata"],
                      ["vault", "Vault"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setContextDrawerTab(id as ContextDrawerTab)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-xs font-bold transition",
                          contextDrawerTab === id ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {contextDrawerTab === "context" ? (
                    <div className="space-y-3">
                      <StatusChipCard label="Context" badge={contextStatus} variant={contextStatusVariant(contextStatus)} detail="Resolved automatically for this app" />
                      <StatusChipCard label="Memory" badge={memoryHealth} variant={appNoteQuality.placeholderCount ? "orange" : "green"} detail="Backend managed" />
                      <StatusChipCard label="Metrics" badge={metricsHealthLabel} variant={metricsHealthVariant} detail={`Source: ${metricsSource}; updated ${metricsLastUpdated}`} />
                      <StatusChipCard label="Vault" badge="Backed" variant="green" detail="App-scoped source" />
                      <StatusChipCard label="Raw" badge={sourceStatus} variant={sourceStatus === "Exists" ? "green" : "orange"} detail="Capture provenance" />
                      <details className="rounded-xl border border-slate-100 bg-white p-3">
                        <summary className="cursor-pointer text-sm font-bold text-slate-950">System Details</summary>
                        <div className="mt-3">
                          <ContextBriefCard brief={contextBrief} />
                        </div>
                      </details>
                    </div>
                  ) : null}

                  {contextDrawerTab === "metadata" ? (
                    selectedSession ? (
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs font-semibold uppercase text-slate-400">Topic</div>
                          <div className="mt-1 text-sm font-bold text-slate-950">{selectedSession.topic || "CMO session"}</div>
                        </div>
                        <div className="grid gap-3">
                          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="text-xs font-semibold uppercase text-slate-400">Runtime</div>
                            <Badge className="mt-2" title={selectedSession.runtimeStatus} variant={runtimeVariant(selectedSession.runtimeStatus)}>{runtimeLabel(selectedSession.runtimeStatus)}</Badge>
                          </div>
                          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="text-xs font-semibold uppercase text-slate-400">Provider</div>
                            <div className="mt-1 text-sm font-bold text-slate-950">{selectedSession.runtimeAgent || selectedSession.runtimeProvider || "not captured"}</div>
                          </div>
                          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="text-xs font-semibold uppercase text-slate-400">Context Status</div>
                            <div className="mt-1 text-sm font-bold text-slate-950">{contextStatus}</div>
                          </div>
                          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                            <div className="text-xs font-semibold uppercase text-slate-400">Created</div>
                            <div className="mt-1 text-sm font-bold text-slate-950">{displayDate(selectedSession.createdAt)}</div>
                          </div>
                          {(() => {
                            const assistantMessage = [...selectedSession.messages].reverse().find((message) => message.role === "assistant");
                            const provenance = assistantMessage ? assistantMessageProvenance(assistantMessage, selectedSession) : null;

                            return provenance ? (
                              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                <div className="text-xs font-semibold uppercase text-slate-400">Latest Answer</div>
                                <div className="mt-1 text-xs font-semibold text-slate-600">{provenance}</div>
                              </div>
                            ) : null;
                          })()}
                        </div>
                      </div>
                    ) : (
                      <EmptyCopy>No session selected.</EmptyCopy>
                    )
                  ) : null}

                  {contextDrawerTab === "decision" ? (
                    selectedSession?.decisionLayer ? (
                      <div className="space-y-4">
                        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                          CMO tracks these outputs automatically. Use chat to review or change status. Nothing is pushed or promoted without explicit approval.
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            ["Outputs", selectedDecisionStatus.total],
                            ["Reviewed", selectedDecisionStatus.reviewed],
                            ["Pending", selectedDecisionStatus.pending],
                            ["Deferred", selectedDecisionStatus.deferred],
                            ["Approved Later", selectedDecisionStatus.approvedForLater],
                            ["Actions", selectedDecisionStatus.suggestedActions],
                            ["Memory", selectedDecisionStatus.memoryCandidates],
                            ["Tasks", selectedDecisionStatus.taskCandidates],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                              <div className="text-[11px] font-bold uppercase text-slate-400">{label}</div>
                              <div className="mt-1 text-lg font-bold text-slate-950">{value}</div>
                            </div>
                          ))}
                        </div>
                        <details className="rounded-xl border border-slate-100 bg-white p-3">
                          <summary className="cursor-pointer text-sm font-bold text-slate-950">Advanced review rows</summary>
                          <div className="mt-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-bold uppercase text-slate-400">Detailed Rows</div>
                              <Button type="button" size="sm" variant="outline" onClick={() => setShowAdvancedDecisionControls((current) => !current)}>
                                {showAdvancedDecisionControls ? "Hide controls" : "Show controls"}
                              </Button>
                            </div>
                          {selectedSession.decisionLayer.suggestedActions.map((item, index) => (
                            <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                              <div className="text-sm font-bold text-slate-950">Action {index + 1}: {item.title}</div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <Badge variant={reviewBadgeVariant(item.reviewStatus)}>{reviewLabel(item.reviewStatus)}</Badge>
                                <Badge variant="slate">{item.priorityHint ?? "no priority"}</Badge>
                              </div>
                              {showAdvancedDecisionControls ? <Button className="mt-2" size="sm" variant="outline" disabled={reviewingDecisionItemId === item.id} onClick={() => void reviewDecisionLayerItem("suggestedAction", item.id, "reviewed")}>Mark Reviewed</Button> : null}
                            </div>
                          ))}
                          {selectedSession.decisionLayer.memoryCandidates.map((item, index) => (
                            <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                              <div className="text-sm font-bold text-slate-950">Memory Candidate {index + 1}</div>
                              <div className="mt-1 text-sm leading-5 text-slate-600">{previewText(item.statement, 140)}</div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <Badge variant="blue">{item.type}</Badge>
                                <Badge variant={reviewBadgeVariant(item.reviewStatus)}>{reviewLabel(item.reviewStatus)}</Badge>
                              </div>
                            </div>
                          ))}
                          {selectedSession.decisionLayer.taskCandidates.map((item, index) => (
                            <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                              <div className="text-sm font-bold text-slate-950">Task Candidate {index + 1}: {item.title}</div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <Badge variant={reviewBadgeVariant(item.reviewStatus)}>{reviewLabel(item.reviewStatus)}</Badge>
                                <Badge variant="slate">{item.pushStatus}</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-2">
                          <div className="text-xs font-bold uppercase text-slate-400">Potential Decisions</div>
                          {sessionPotentialDecisions(selectedSession).length ? sessionPotentialDecisions(selectedSession).map((decision) => (
                            <div key={decision} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">{decision}</div>
                          )) : <EmptyCopy>No potential decisions extracted.</EmptyCopy>}
                          </div>
                        </details>
                        {decisionReviewStatus ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{decisionReviewStatus}</div> : null}
                        {decisionReviewError ? <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{decisionReviewError}</div> : null}
                      </div>
                    ) : (
                      <EmptyCopy>No Decision Layer has been extracted for the selected session.</EmptyCopy>
                    )
                  ) : null}

                  {contextDrawerTab === "vault" ? (
                    selectedSession ? (
                      <div id="raw-capture" className="space-y-3">
                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="text-xs font-semibold uppercase text-slate-400">Session Note</div>
                          <div className="mt-1 break-all text-xs font-medium text-slate-600">{selectedSession.sessionNotePath || "not saved yet"}</div>
                        </div>
                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="text-xs font-semibold uppercase text-slate-400">Raw Capture</div>
                          <div className="mt-1 break-all text-xs font-medium text-slate-600">{selectedSession.rawCapturePath || "not captured yet"}</div>
                        </div>
                        <Button className="w-full" variant="outline" onClick={() => void saveSelectedSessionToVault()} disabled={!selectedSession.messages.length || isSavingSelectedSession}>
                          {isSavingSelectedSession ? <icons.RefreshCw className="animate-spin" /> : <icons.FileText />}
                          Save Session to Vault
                        </Button>
                        <Button className="w-full" onClick={() => void captureSelectedSessionToRawVault()} disabled={!selectedSession.messages.length || Boolean(selectedSession.rawCapturePath) || isCapturingSelectedSession}>
                          {isCapturingSelectedSession ? <icons.RefreshCw className="animate-spin" /> : <icons.Database />}
                          {selectedSession.rawCapturePath ? "Raw Captured" : "Capture to Raw Vault"}
                        </Button>
                        <Button type="button" className="w-full" size="sm" variant="outline" onClick={() => selectTab("plan", "promotion-candidates")}>
                          <icons.Sparkles />
                          Promotion Candidates
                        </Button>
                        {sessionStatus ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{sessionStatus}</div> : null}
                        {sessionError ? <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{sessionError}</div> : null}
                      </div>
                    ) : (
                      <EmptyCopy>No session selected.</EmptyCopy>
                    )
                  ) : null}
                </div>
              </aside>
            ) : null}
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
