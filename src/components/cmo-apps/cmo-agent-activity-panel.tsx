import { Badge } from "@/components/ui/badge";
import { icons } from "@/components/dashboard/icons";
import type {
  CMOChatMessage,
  HermesCmoActivityEventSummary,
  HermesCmoDelegationSummaryItem,
} from "@/lib/cmo/app-workspace-types";
import {
  cmoActivityEventDelegationId,
  cmoActivityEventId,
  cmoActivityEventMessage,
  cmoActivityEventSourceAgent,
  cmoActivityEventSourceMode,
  cmoActivityEventStatus,
  cmoActivityEventTitle,
  cmoActivityEventType,
  cmoActivityEventUserVisible,
} from "@/lib/cmo/activity-events";
import { buildCmoActivitySteps } from "@/lib/cmo/cmo-chat-evidence-display";
import { cn } from "@/lib/utils";

type ActivityStatus = "running" | "waiting" | "completed" | "failed" | "timed_out" | "skipped";
type ActivityAgent = "cmo" | "product" | "hermes" | "surf" | "echo" | "lens" | "creative" | "vault" | "vault_agent" | string;

interface ActivityRow {
  key: string;
  label: string;
  status: ActivityStatus;
  detail?: string;
}

function compactDetail(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

interface CmoAgentActivityPanelProps {
  message?: CMOChatMessage;
  running?: boolean;
  elapsedMs?: number | null;
}

function normalizeStatus(value: string | undefined, fallback: ActivityStatus): ActivityStatus {
  if (value === "queued") {
    return "waiting";
  }

  if (value === "cancelled" || value === "canceled" || value === "interrupted") {
    return "failed";
  }

  if (value === "running" || value === "waiting" || value === "completed" || value === "failed" || value === "timed_out" || value === "skipped") {
    return value === "timed_out" ? "timed_out" : value;
  }

  return fallback;
}

function agentLabel(agent: ActivityAgent | undefined): string {
  if (agent === "vault_agent" || agent === "vault") return "Vault Agent";
  if (agent === "product") return "Product";
  if (agent === "hermes") return "Hermes";
  if (agent === "lens") return "Lens";
  if (agent === "creative") return "Creative Agent";
  if (agent === "surf") return "Surf Agent";
  if (agent === "echo") return "Echo Agent";
  return "CMO";
}

function eventLabel(event: HermesCmoActivityEventSummary): string {
  const sourceAgent = cmoActivityEventSourceAgent(event);
  const type = cmoActivityEventType(event);

  if (sourceAgent === "creative" || type.startsWith("creative.")) {
    return "Creative Agent";
  }

  if (type === "delegation.started") {
    return agentLabel(sourceAgent);
  }

  if (type === "delegation.completed") {
    return agentLabel(sourceAgent);
  }

  if (type === "clarification.required" || type === "clarification.asked") {
    return "Waiting for user";
  }

  if (type === "run.failed") {
    return "CMO";
  }

  if (type === "run.completed" || type === "cmo.run.completed") {
    return "CMO";
  }

  return "CMO";
}

function eventDetail(event: HermesCmoActivityEventSummary): string | undefined {
  return compactDetail(cmoActivityEventMessage(event) || cmoActivityEventTitle(event));
}

function displayStatusForCreativeEvent(event: HermesCmoActivityEventSummary): ActivityStatus {
  const type = cmoActivityEventType(event);
  const status = cmoActivityEventStatus(event);

  if (type === "creative.started" || type === "creative.generating") {
    return status === "failed" ? "failed" : "running";
  }

  if (type === "creative.asset_ready") {
    return "completed";
  }

  if (type === "creative.partial" || type === "creative.blocked") {
    return type === "creative.blocked" ? "failed" : "waiting";
  }

  if (type === "creative.failed") {
    return "failed";
  }

  return normalizeStatus(status, "completed");
}

function lifecycleLabel(type: string, status: string): string {
  if (type === "product.chat_run.queued" || status === "queued") return "CMO queued";
  if (type === "product.chat_run.running" || status === "running") return "CMO running";
  if (type === "product.chat_run.completed" || status === "completed") return "CMO completed";
  if (type === "product.chat_run.failed" || status === "failed") return "CMO failed";
  if (type === "product.chat_run.timed_out" || status === "timed_out") return "CMO timed out";
  if (type === "product.chat_run.cancelled" || status === "cancelled") return "CMO cancelled";
  return "CMO";
}

function lifecycleDetail(event: HermesCmoActivityEventSummary, message: CMOChatMessage | undefined): string | undefined {
  const explicitDetail = eventDetail(event);
  const status = cmoActivityEventStatus(event);

  if (explicitDetail) {
    return explicitDetail;
  }

  if (status === "failed") {
    return compactDetail(message?.hermesCmoErrorReason ?? message?.runtimeErrorReason ?? message?.productFallbackReason ?? "Run failed.");
  }

  if (status === "timed_out") {
    return "Timed out before Hermes returned a final result.";
  }

  if (status === "cancelled") {
    return "Stopped by user.";
  }

  return undefined;
}

function lifecycleRows(
  events: HermesCmoActivityEventSummary[],
  message: CMOChatMessage | undefined,
): ActivityRow[] {
  return events
    .filter((event) => cmoActivityEventUserVisible(event) && cmoActivityEventType(event).startsWith("product.chat_run."))
    .map((event, index) => {
      const type = cmoActivityEventType(event);
      const status = cmoActivityEventStatus(event);

      return {
        key: `${cmoActivityEventId(event) || type}-${index}`,
        label: lifecycleLabel(type, status),
        status: normalizeStatus(status, "completed"),
        detail: lifecycleDetail(event, message),
      };
    });
}

function delegationAgent(agent: ActivityAgent | undefined): ActivityAgent | undefined {
  return agent && agent !== "cmo" && agent !== "product" && agent !== "hermes" ? agent : undefined;
}

function delegationMatchKey(agent: ActivityAgent | undefined, mode: string | undefined): string | null {
  if (!delegationAgent(agent)) {
    return null;
  }

  return `${agent}:${mode ?? "*"}`;
}

function hasDelegationMatch(matches: Set<string>, agent: ActivityAgent | undefined, mode: string | undefined): boolean {
  if (!agent) {
    return false;
  }

  return matches.has(`${agent}:${mode ?? "*"}`) || matches.has(`${agent}:*`);
}

function delegationOutcomeSets(
  events: HermesCmoActivityEventSummary[],
  delegations: HermesCmoDelegationSummaryItem[],
): { completed: Set<string>; failed: Set<string> } {
  const completed = new Set<string>();
  const failed = new Set<string>();
  const addMatch = (target: Set<string>, agent: ActivityAgent | undefined, mode: string | undefined) => {
    const key = delegationMatchKey(agent, mode);

    if (key) {
      target.add(key);
    }
  };

  events.forEach((event) => {
    const type = cmoActivityEventType(event);
    const status = cmoActivityEventStatus(event);
    const sourceAgent = cmoActivityEventSourceAgent(event);
    const sourceMode = cmoActivityEventSourceMode(event);

    if (!cmoActivityEventUserVisible(event) || type !== "delegation.completed") {
      return;
    }

    if (status === "failed") {
      addMatch(failed, delegationAgent(sourceAgent), sourceMode);
      return;
    }

    if (status === "completed") {
      addMatch(completed, delegationAgent(sourceAgent), sourceMode);
    }
  });

  delegations.forEach((delegation) => {
    if (delegation.status === "failed") {
      addMatch(failed, delegation.targetAgent, delegation.mode);
      return;
    }

    if (delegation.status === "completed") {
      addMatch(completed, delegation.targetAgent, delegation.mode);
    }
  });

  return { completed, failed };
}

function displayStatusForEvent(
  event: HermesCmoActivityEventSummary,
  outcomes: { completed: Set<string>; failed: Set<string> },
): ActivityStatus {
  const type = cmoActivityEventType(event);
  const status = cmoActivityEventStatus(event);
  const sourceAgent = cmoActivityEventSourceAgent(event);
  const sourceMode = cmoActivityEventSourceMode(event);
  const fallback = normalizeStatus(status, type === "delegation.started" ? "running" : "completed");

  if (type !== "delegation.started" || !delegationAgent(sourceAgent)) {
    return fallback;
  }

  if (hasDelegationMatch(outcomes.failed, sourceAgent, sourceMode)) {
    return "failed";
  }

  if (hasDelegationMatch(outcomes.completed, sourceAgent, sourceMode)) {
    return "completed";
  }

  return fallback;
}

function representedDelegationKeys(events: HermesCmoActivityEventSummary[]): { ids: Set<string>; matches: Set<string> } {
  const ids = new Set<string>();
  const matches = new Set<string>();

  events.forEach((event) => {
    const type = cmoActivityEventType(event);

    if (!cmoActivityEventUserVisible(event) || !type.startsWith("delegation.")) {
      return;
    }

    const delegationId = cmoActivityEventDelegationId(event);
    const matchKey = delegationMatchKey(cmoActivityEventSourceAgent(event), cmoActivityEventSourceMode(event));

    if (delegationId) {
      ids.add(delegationId);
    }

    if (matchKey) {
      matches.add(matchKey);
    }
  });

  return { ids, matches };
}

function delegationRows(
  delegations: HermesCmoDelegationSummaryItem[],
  representedDelegations: { ids: Set<string>; matches: Set<string> },
): ActivityRow[] {
  if (delegations.length === 0) {
    return [];
  }

  return delegations
    .filter((delegation) => {
      if (representedDelegations.ids.has(delegation.delegationId)) {
        return false;
      }

      const matchKey = delegationMatchKey(delegation.targetAgent, delegation.mode);

      return !matchKey || !representedDelegations.matches.has(matchKey);
    })
    .flatMap((delegation, index) => {
      const label = agentLabel(delegation.targetAgent);
      const status = normalizeStatus(delegation.status, "completed");

      return [
        {
          key: `delegation-call-${delegation.delegationId}-${index}`,
          label,
          status: status === "failed" ? "completed" : status,
        },
        {
          key: `delegation-result-${delegation.delegationId}-${index}`,
          label,
          status,
        },
      ];
    });
}

function statusFromCmoRun(value: CMOChatMessage["cmoRunStatus"] | undefined): ActivityStatus | null {
  if (value === "pending" || value === "running") return "running";
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "timed_out") return "timed_out";
  if (value === "interrupted" || value === "cancelled") return "failed";
  return null;
}

function friendlyToolsUsed(message: CMOChatMessage | undefined): Array<"surf" | "echo" | "creative"> {
  const rawTools = [
    ...(message?.cmoRunToolsUsed ?? []),
    ...(message?.agentsUsed ?? []),
    ...(message?.hermesCmoMetadata?.agentsUsed ?? []),
    ...(message?.hermesCmoMetadata?.toolsUsed ?? []),
    ...(message?.hermesCmoMetadata?.tools_used ?? []),
  ];
  const tools = new Set<"surf" | "echo" | "creative">();

  if (message?.hermesCmoMetadata?.cmo_call_surf_used === true) {
    tools.add("surf");
  }

  if (message?.hermesCmoMetadata?.cmo_call_echo_used === true) {
    tools.add("echo");
  }

  rawTools.forEach((tool) => {
    if (tool === "surf" || tool === "cmo_call_surf") {
      tools.add("surf");
    }

    if (tool === "echo" || tool === "cmo_call_echo") {
      tools.add("echo");
    }

    if (tool === "creative" || tool === "cmo_call_creative") {
      tools.add("creative");
    }
  });

  return Array.from(tools);
}

function toolMetadataRows(message: CMOChatMessage | undefined, existingAgents: Set<"surf" | "echo" | "creative">): ActivityRow[] {
  const runStatus = statusFromCmoRun(message?.cmoRunStatus);

  if (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "timed_out") {
    return [];
  }

  return friendlyToolsUsed(message)
    .filter((agent) => !existingAgents.has(agent))
    .map((agent) => ({
      key: `tool-metadata-${agent}`,
      label: agentLabel(agent),
      status: runStatus === "completed" ? "completed" : runStatus,
    }));
}

function toolAgentFromRow(row: ActivityRow): "surf" | "echo" | "creative" | null {
  if (row.label === "Surf Agent") return "surf";
  if (row.label === "Echo Agent") return "echo";
  if (row.label === "Creative Agent") return "creative";
  return null;
}

function activityRows(message: CMOChatMessage | undefined, running: boolean): ActivityRow[] {
  const hermesFirstMessage =
    message?.productRenderSource === "hermes_cmo" ||
    message?.productRenderSource === "hermes_cmo_boundary_failure";
  const events = message?.activityEvents ?? message?.hermesCmoMetadata?.activityEvents ?? [];
  const lifecycle = lifecycleRows(events, message);

  if (message && !hermesFirstMessage && lifecycle.length === 0) {
    const displaySteps = buildCmoActivitySteps(message, running);
    const hasSpecificEvidenceStep = displaySteps.some((step) =>
      step.label === "Lens" ||
      step.label === "GA4 query" ||
      step.label === "Dune business" ||
      step.label === "Product Dune native" ||
      step.label === "Metric snapshot" ||
      step.label === "Cached snapshot" ||
      step.label === "Vault report"
    );

    if (running || hasSpecificEvidenceStep) {
      return displaySteps;
    }
  }

  if (running && lifecycle.length === 0 && events.length === 0) {
    return [
      {
        key: "optimistic-cmo-running",
        label: "CMO",
        status: "running",
      },
    ];
  }

  const delegations = message?.delegationSummary ?? message?.hermesCmoMetadata?.delegationSummary ?? [];
  const rows: ActivityRow[] = [];
  const firstCmoEvent = events.find((event) => cmoActivityEventUserVisible(event) && cmoActivityEventSourceAgent(event) === "cmo");
  const delegationEvents = events.filter((event) => {
    const type = cmoActivityEventType(event);

    return cmoActivityEventUserVisible(event) && (type === "delegation.started" || type === "delegation.completed");
  });
  const creativeEvents = events.filter((event) => {
    const type = cmoActivityEventType(event);

    return cmoActivityEventUserVisible(event) && (cmoActivityEventSourceAgent(event) === "creative" || type.startsWith("creative."));
  });
  const hasDelegationEvents = delegationEvents.length > 0;
  const representedDelegations = representedDelegationKeys(events);
  const delegationOutcomes = delegationOutcomeSets(events, delegations);
  const hasFriendlyTools = friendlyToolsUsed(message).length > 0;
  const hasSpecialistWork = hasDelegationEvents || delegations.length > 0 || hasFriendlyTools;

  rows.push(...lifecycle);

  if (hasSpecialistWork && lifecycle.length === 0) {
    rows.push({
      key: "cmo-analyzing",
      label: "CMO analyzing",
      status: "completed",
    });
  }

  rows.push(
    ...delegationEvents
      .filter((event) => {
        const sourceAgent = cmoActivityEventSourceAgent(event);

        return Boolean(delegationAgent(sourceAgent)) && sourceAgent !== "creative";
      })
      .map((event, index): ActivityRow => ({
        key: `${cmoActivityEventId(event)}-${index}`,
        label: eventLabel(event),
        status: displayStatusForEvent(event, delegationOutcomes),
        detail: eventDetail(event),
      })),
  );

  rows.push(
    ...creativeEvents.map((event, index): ActivityRow => ({
      key: `${cmoActivityEventId(event)}-creative-${index}`,
      label: eventLabel(event),
      status: displayStatusForCreativeEvent(event),
      detail: eventDetail(event) ?? cmoActivityEventType(event).replace(/^creative\./, ""),
    })),
  );

  rows.push(...delegationRows(delegations, representedDelegations));

  const existingAgents = new Set(
    rows
      .map(toolAgentFromRow)
      .filter((agent): agent is "surf" | "echo" | "creative" => Boolean(agent)),
  );
  rows.push(...toolMetadataRows(message, existingAgents));

  const runStatus = statusFromCmoRun(message?.cmoRunStatus);
  const finalStatus = runStatus === "failed" || runStatus === "timed_out"
    ? runStatus
    : rows.some((row) => row.status === "failed" || row.status === "timed_out")
      ? "failed"
      : "completed";

  if (rows.length > 0) {
    if (!running && runStatus !== "running") {
      rows.push({
        key: "cmo-final-answer",
        label: "CMO final answer",
        status: finalStatus,
      });
    }

    return rows;
  }

  if (firstCmoEvent || events.length > 0 || message?.currentStep || message?.hermesCmoMetadata?.currentStep || message?.cmoRunStatus) {
    return [
      {
        key: "cmo-completed",
        label: "CMO",
        status: finalStatus,
      },
    ];
  }

  return rows;
}

function statusVariant(status: ActivityStatus): "green" | "orange" | "red" | "slate" | "blue" {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "timed_out") return "red";
  if (status === "running") return "blue";
  if (status === "waiting") return "orange";
  return "slate";
}

function statusIcon(status: ActivityStatus) {
  if (status === "completed") return <icons.CheckCircle2 className="size-3.5" />;
  if (status === "failed") return <icons.AlertTriangle className="size-3.5" />;
  if (status === "timed_out") return <icons.AlertTriangle className="size-3.5" />;
  if (status === "running") return <icons.RefreshCw className="size-3.5 animate-spin" />;
  if (status === "waiting") return <icons.Clock3 className="size-3.5" />;
  return <icons.Activity className="size-3.5" />;
}

function statusLabel(status: ActivityStatus): string {
  return status === "timed_out" ? "timed out" : status;
}

function formatDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function overallStatus(rows: ActivityRow[], running: boolean): ActivityStatus {
  if (running) return "running";
  if (rows.some((row) => row.status === "timed_out")) return "timed_out";
  if (rows.some((row) => row.status === "failed")) return "failed";
  if (rows.some((row) => row.status === "waiting")) return "waiting";
  return rows.length > 0 ? "completed" : "skipped";
}

export function CmoAgentActivityPanel({ message, running = false, elapsedMs = null }: CmoAgentActivityPanelProps) {
  const rows = activityRows(message, running);

  if (rows.length === 0) {
    return null;
  }

  const status = overallStatus(rows, running);
  const duration = formatDuration(running ? elapsedMs : message?.totalDurationMs ?? message?.liveAttemptDurationMs);
  const currentStep = running
    ? rows[rows.length - 1]?.label ?? "CMO running"
    : rows[rows.length - 1]?.status === "timed_out"
      ? "CMO timed out"
      : rows[rows.length - 1]?.status === "failed"
        ? "CMO failed"
        : "CMO completed";

  return (
    <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3" open={running}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white text-indigo-700 ring-1 ring-indigo-100">
              <icons.Activity className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-extrabold uppercase text-slate-500">Agent Activity</div>
              <div className="truncate text-sm font-bold text-slate-900">{currentStep}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {duration ? <span className="text-xs font-semibold text-slate-500">{duration}</span> : null}
            <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
          </div>
        </div>
      </summary>

      <div className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <div key={row.key} className="grid grid-cols-[1.25rem_1fr_auto] items-start gap-2">
            <span
              className={cn(
                "relative grid size-5 place-items-center rounded-full",
                index < rows.length - 1 ? "after:absolute after:left-1/2 after:top-5 after:h-4 after:w-px after:-translate-x-1/2 after:bg-slate-200" : null,
                row.status === "completed" ? "bg-emerald-50 text-emerald-700" : null,
                row.status === "failed" || row.status === "timed_out" ? "bg-red-50 text-red-700" : null,
                row.status === "running" ? "bg-blue-50 text-blue-700" : null,
                row.status === "waiting" ? "bg-orange-50 text-orange-700" : null,
                row.status === "skipped" ? "bg-slate-100 text-slate-500" : null,
              )}
            >
              {statusIcon(row.status)}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900">{row.label}</div>
              {row.detail ? <div className="mt-0.5 break-words text-xs font-semibold leading-5 text-slate-500">{row.detail}</div> : null}
            </div>
            <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
          </div>
        ))}
      </div>
    </details>
  );
}
