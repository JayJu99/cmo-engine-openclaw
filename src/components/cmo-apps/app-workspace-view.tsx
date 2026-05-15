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
  if (status === "connected") {
    return "Runtime connected";
  }

  if (status === "configured_but_unreachable") {
    return "Runtime unavailable";
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
  if (status === "connected") {
    return "green";
  }

  if (status === "configured_but_unreachable" || status === "runtime_error") {
    return "red";
  }

  if (status === "development_fallback" || status === "not_configured") {
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
  const [sessionFocusSignal, setSessionFocusSignal] = useState(0);
  const [memoryRefreshSignal, setMemoryRefreshSignal] = useState(0);
  const [promotionRefreshSignal, setPromotionRefreshSignal] = useState(0);
  const appNoteQuality = useMemo(() => summarizeContextQuality(appNotes), [appNotes]);
  const selectedQuality = contextBrief.contextQualitySummary;
  const selectedSession = selectedSessionId ? sessions.find((session) => session.id === selectedSessionId) : undefined;
  const latestSession = sessions[0];
  const mostAppNotesArePlaceholders = appNoteQuality.selectedCount > 0 && appNoteQuality.placeholderCount > appNoteQuality.selectedCount / 2;

  useEffect(() => {
    const nextTab: AppWorkspaceTab = isWorkspaceTab(tabParam) ? tabParam : "dashboard";
    const timeout = window.setTimeout(() => {
      setActiveTab((current) => (current === nextTab ? current : nextTab));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [tabParam]);

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
              `Fallback: ${selectedSession.isDevelopmentFallback ? "true" : "false"}.`,
              `Context quality: ${sessionContextSummary(selectedSession)}.`,
              selectedSession.sessionNotePath ? `Full session note: ${selectedSession.sessionNotePath}.` : "Full session note not saved yet.",
            ].join("\n"),
            selectedContextNotes: [...selectedSession.contextUsed, ...(selectedSession.missingContext ?? [])],
            messages: selectedSession.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            contextUsed: selectedSession.contextUsed,
            missingContext: selectedSession.missingContext,
            runtimeStatus: selectedSession.runtimeStatus,
            runtimeMode: selectedSession.runtimeMode,
            isDevelopmentFallback: selectedSession.isDevelopmentFallback,
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

  const headerActions = (
    <>
      <Button asChild>
        <Link
          href={`${pathname}?tab=sessions#cmo-session`}
          onClick={focusCurrentCmoSession}
        >
          <icons.MessageSquare />
          Start CMO Session
        </Link>
      </Button>
      {selectedSession && selectedSession.messages.length && !selectedSession.rawCapturePath ? (
        <Button asChild variant="outline">
          <Link href={`${pathname}?tab=sessions#raw-capture`} onClick={() => setActiveTab("sessions")}>
            <icons.Database />
            Capture to Raw Vault
          </Link>
        </Button>
      ) : (
        <Button variant="outline" disabled title="Capture becomes available after a selected CMO session has messages.">
          <icons.Database />
          Capture to Raw Vault
        </Button>
      )}
      <Button asChild variant="outline">
        <Link href={`/apps/${app.slug}?tab=plan`} onClick={() => selectTab("plan")}>
          <icons.FileText />
          Generate/Review Plan
        </Link>
      </Button>
    </>
  );

  return (
    <PageChrome title={app.name} description="Tab-based App Operating Workspace for CMO context, planning, tasks, sessions, and Vault capture." actions={headerActions}>
      <Card className="p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={app.stage === "Active" ? "green" : "slate"}>{app.stage || "Unknown stage"}</Badge>
              <Badge variant="slate">{app.group}</Badge>
              <Badge title={state.initialRuntimeStatus ?? "not_checked"} variant={runtimeVariant(state.initialRuntimeStatus)}>{runtimeLabel(state.initialRuntimeStatus)}</Badge>
              <Badge variant={selectedQuality.missingCount ? "orange" : "slate"}>
                Context: {selectedQuality.existingCount}/{selectedQuality.selectedCount}
              </Badge>
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">{app.currentMission || "No active mission yet."}</h2>
            <CardDescription className="mt-2 break-all">{app.vaultPath}</CardDescription>
            {state.initialRuntimeReason ? <p className="mt-2 text-sm font-medium text-slate-500">{state.initialRuntimeReason}</p> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[520px]">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase text-slate-400">C-Level Priority</div>
              <div className="mt-1 font-bold text-slate-950">{priorityState.activePriority?.title || "Missing"}</div>
              {priorityState.activePriority ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge>{priorityState.activePriority.priorityLevel}</Badge>
                  <Badge variant="green">{priorityState.activePriority.status}</Badge>
                  <Badge variant="slate">{priorityState.activePriority.timeframe}</Badge>
                </div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase text-slate-400">Last Updated</div>
              <div className="mt-1 font-bold text-slate-950">{app.lastUpdated || "Vault-backed"}</div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase text-slate-400">App Memory</div>
              <div className="mt-1 font-bold text-slate-950">
                {appNoteQuality.existingCount} / {appNoteQuality.selectedCount} found
              </div>
              <div className="mt-1 text-xs font-medium text-slate-500">
                {appNoteQuality.confirmedCount} confirmed, {appNoteQuality.draftCount} draft, {appNoteQuality.placeholderCount} need content
              </div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase text-slate-400">Today</div>
              <div className="mt-1 font-bold text-slate-950">
                Raw {state.todayRawExists ? "exists" : "missing"} / Daily {state.todayDailyExists ? "exists" : "missing"}
              </div>
            </div>
          </div>
        </div>
        {mostAppNotesArePlaceholders ? (
          <div className="mt-5 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-800">
            Most app memory notes need content. CMO output may rely on assumptions until durable app memory is filled.
          </div>
        ) : null}
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
              <EmptyCopy>No metrics connected yet. Metrics can be added later from project docs or data sources.</EmptyCopy>
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
                    <Badge variant={latestSession.isDevelopmentFallback ? "orange" : "green"}>{latestSession.isDevelopmentFallback ? "fallback used" : "runtime answer"}</Badge>
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
                <div className="text-xs font-semibold uppercase text-slate-400">App Memory</div>
                <div className="mt-2 text-sm font-bold text-slate-950">
                  {appNoteQuality.confirmedCount} confirmed / {appNoteQuality.draftCount} draft / {appNoteQuality.placeholderCount} need content
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase text-slate-400">Metrics</div>
                <Badge className="mt-2" variant={state.dashboardSnapshot.metricsStatus === "missing" ? "orange" : "green"}>{state.dashboardSnapshot.metricsStatus}</Badge>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase text-slate-400">C-Level Priority</div>
                <Badge className="mt-2" variant={priorityState.activePriority ? "green" : "orange"}>{priorityState.activePriority ? "active" : "missing"}</Badge>
              </div>
            </div>
          </SectionCard>

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
      ) : null}

      {activeTab === "inputs" ? (
        <div className="grid gap-6 2xl:grid-cols-[1fr_0.9fr]">
          <div className="space-y-6">
            <SectionCard title="C-Level Priority" icon={<icons.Target />} action={<Badge variant={priorityState.activePriority ? "green" : "orange"}>{priorityState.activePriority ? "active" : "missing"}</Badge>}>
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
            </SectionCard>

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

          <div className="space-y-6">
            <ContextBriefCard brief={contextBrief} />

            <SectionCard title="App Memory Quality" icon={<icons.Database />}>
              <div className="flex flex-wrap gap-2">
                <Badge variant={appNoteQuality.confirmedCount ? "green" : "slate"}>{appNoteQuality.confirmedCount} confirmed</Badge>
                <Badge variant={appNoteQuality.draftCount ? "blue" : "slate"}>{appNoteQuality.draftCount} draft</Badge>
                <Badge variant={appNoteQuality.placeholderCount ? "orange" : "slate"}>{appNoteQuality.placeholderCount} need content</Badge>
                <Badge variant={appNoteQuality.missingCount ? "red" : "slate"}>{appNoteQuality.missingCount} missing</Badge>
              </div>
              {mostAppNotesArePlaceholders ? <p className="mt-3 text-sm font-medium text-orange-700">Most notes need more content before CMO output can be fully grounded.</p> : null}
            </SectionCard>
          </div>
        </div>
      ) : null}

      {activeTab === "plan" ? (
        <div className="space-y-6">
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
              <PromotionCandidatesSection appId={app.id} refreshSignal={promotionRefreshSignal} onPromoted={refreshWorkspaceAfterMemoryChange} />
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
        <div className="space-y-6">
          <div id="cmo-session" className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-950">Current Session</h2>
                <p className="text-sm text-slate-500">Ask the next app-specific CMO question. The context brief is resolved automatically.</p>
              </div>
              <Badge title={state.initialRuntimeStatus ?? "not_checked"} variant={runtimeVariant(state.initialRuntimeStatus)}>{runtimeLabel(state.initialRuntimeStatus)}</Badge>
            </div>
            <CMOChatPanel
              app={app}
              contextBrief={contextBrief}
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
            />
          </div>

          <div className="grid gap-6 2xl:grid-cols-[0.85fr_1.15fr]">
            <SectionCard title="Session History" icon={<icons.Clock3 />} action={<Badge variant="slate">{sessions.length} sessions</Badge>}>
              {sessions.length ? (
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setSelectedSessionId(session.id)}
                      className={cn(
                        "w-full rounded-xl border px-4 py-3 text-left transition",
                        selectedSession?.id === session.id ? "border-indigo-200 bg-indigo-50/70" : "border-slate-100 bg-slate-50 hover:border-slate-200",
                      )}
                      aria-pressed={selectedSession?.id === session.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-950">{session.topic || "CMO session"}</div>
                          <div className="mt-1 text-xs font-medium text-slate-500">{displayDate(session.createdAt)}</div>
                        </div>
                        <Badge title={session.runtimeStatus} variant={runtimeVariant(session.runtimeStatus)}>{runtimeLabel(session.runtimeStatus)}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant={session.isDevelopmentFallback ? "orange" : "green"}>{session.isDevelopmentFallback ? "fallback used" : "runtime answer"}</Badge>
                        <Badge variant="slate">{session.contextUsed.length} context notes</Badge>
                        <Badge variant={session.savedToVault ? "green" : "slate"}>{session.savedToVault ? "saved" : "not saved"}</Badge>
                        <Badge variant={session.rawCapturePath ? "green" : "slate"}>{session.rawCapturePath ? "raw captured" : "raw pending"}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyCopy>No sessions for this app yet.</EmptyCopy>
              )}
            </SectionCard>

            <SectionCard title="Session Metadata" icon={<icons.Database />}>
              {selectedSession ? (
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-400">Topic</div>
                    <div className="mt-1 font-bold text-slate-950">{selectedSession.topic || "CMO session"}</div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase text-slate-400">Runtime</div>
                      <Badge className="mt-2" title={selectedSession.runtimeStatus} variant={runtimeVariant(selectedSession.runtimeStatus)}>{runtimeLabel(selectedSession.runtimeStatus)}</Badge>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase text-slate-400">Fallback</div>
                      <Badge className="mt-2" variant={selectedSession.isDevelopmentFallback ? "orange" : "green"}>{selectedSession.isDevelopmentFallback ? "used" : "not used"}</Badge>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase text-slate-400">Context Used</div>
                      <div className="mt-2 text-sm font-bold text-slate-950">{sessionContextSummary(selectedSession)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-semibold uppercase text-slate-400">Created</div>
                      <div className="mt-2 text-sm font-bold text-slate-950">{displayDate(selectedSession.createdAt)}</div>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <p className="break-all text-xs font-medium text-slate-500">Session note: {selectedSession.sessionNotePath || "not saved yet"}</p>
                    <p className="break-all text-xs font-medium text-slate-500">Raw capture: {selectedSession.rawCapturePath || "not captured yet"}</p>
                    <p className="text-xs font-medium text-slate-500">Related priority: {priorityState.activePriority?.title || "none linked"}</p>
                    <p className="text-xs font-medium text-slate-500">Related plan: {plans.weekly.exists ? plans.weekly.path : "none linked"}</p>
                  </div>
                  <div id="raw-capture" className="flex flex-wrap gap-3">
                    <Button variant="outline" onClick={() => void saveSelectedSessionToVault()} disabled={!selectedSession.messages.length || isSavingSelectedSession}>
                      {isSavingSelectedSession ? <icons.RefreshCw className="animate-spin" /> : <icons.FileText />}
                      Save Session to Vault
                    </Button>
                    <Button onClick={() => void captureSelectedSessionToRawVault()} disabled={!selectedSession.messages.length || Boolean(selectedSession.rawCapturePath) || isCapturingSelectedSession}>
                      {isCapturingSelectedSession ? <icons.RefreshCw className="animate-spin" /> : <icons.Database />}
                      {selectedSession.rawCapturePath ? "Raw Captured" : "Capture to Raw Vault"}
                    </Button>
                  </div>
                  {(selectedSession.sessionNotePath || selectedSession.rawCapturePath) ? (
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-semibold text-indigo-800">Promote useful context to App Memory.</p>
                        <Button type="button" size="sm" variant="outline" onClick={() => selectTab("plan", "promotion-candidates")}>
                          <icons.Sparkles />
                          Promotion Candidates
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {sessionStatus ? <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{sessionStatus}</div> : null}
                  {sessionError ? <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{sessionError}</div> : null}
                </div>
              ) : (
                <EmptyCopy>No session selected.</EmptyCopy>
              )}
            </SectionCard>
          </div>

          {selectedSession ? (
            <SectionCard title="Selected Session Messages" icon={<icons.MessageSquare />}>
              <div className="space-y-3">
                {selectedSession.messages.map((message) => (
                  <div key={message.id} className={cn("rounded-xl px-4 py-3 text-sm leading-6", message.role === "user" ? "bg-indigo-600 text-white" : "border border-slate-100 bg-slate-50 text-slate-700")}>
                    <div className="mb-1 text-xs font-bold uppercase opacity-80">{message.role === "assistant" ? "CMO" : message.role}</div>
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="Potential Decisions" icon={<icons.Lightbulb />}>
            {sessionPotentialDecisions(selectedSession).length ? (
              <div className="space-y-2">
                {sessionPotentialDecisions(selectedSession).map((decision) => (
                  <div key={decision} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">{decision}</div>
                ))}
              </div>
            ) : (
              <EmptyCopy>No potential decisions extracted from the selected CMO answer.</EmptyCopy>
            )}
            <p className="mt-3 text-xs font-semibold text-slate-500">Decision locking comes in Phase 2.</p>
          </SectionCard>

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
