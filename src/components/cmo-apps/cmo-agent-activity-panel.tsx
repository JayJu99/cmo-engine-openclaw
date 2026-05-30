import { Badge } from "@/components/ui/badge";
import { icons } from "@/components/dashboard/icons";
import type {
  CMOChatMessage,
  HermesCmoActivityEventSummary,
  HermesCmoDelegationSummaryItem,
} from "@/lib/cmo/app-workspace-types";
import { cn } from "@/lib/utils";

type ActivityStatus = "running" | "waiting" | "completed" | "failed" | "skipped";

interface ActivityRow {
  key: string;
  label: string;
  status: ActivityStatus;
  detail?: string;
}

interface CmoAgentActivityPanelProps {
  message?: CMOChatMessage;
  running?: boolean;
  elapsedMs?: number | null;
}

function normalizeStatus(value: string | undefined, fallback: ActivityStatus): ActivityStatus {
  if (value === "running" || value === "waiting" || value === "completed" || value === "failed" || value === "skipped") {
    return value;
  }

  return fallback;
}

function agentLabel(agent: "cmo" | "echo" | "surf" | undefined): string {
  if (agent === "surf") return "Surf";
  if (agent === "echo") return "Echo";
  return "CMO";
}

function eventLabel(event: HermesCmoActivityEventSummary): string {
  if (event.type === "delegation.started") {
    return `Calling ${agentLabel(event.sourceAgent)}`;
  }

  if (event.type === "delegation.completed") {
    return event.status === "failed" ? `${agentLabel(event.sourceAgent)} failed` : `${agentLabel(event.sourceAgent)} completed`;
  }

  if (event.type === "clarification.required" || event.type === "clarification.asked") {
    return "Waiting for user";
  }

  if (event.type === "run.failed") {
    return "CMO failed";
  }

  if (event.type === "run.completed" || event.type === "cmo.run.completed") {
    return "CMO synthesizing final answer";
  }

  return "CMO analyzing";
}

function delegationMatchKey(agent: "echo" | "surf" | undefined, mode: string | undefined): string | null {
  if (!agent) {
    return null;
  }

  return `${agent}:${mode ?? "*"}`;
}

function hasDelegationMatch(matches: Set<string>, agent: "echo" | "surf" | undefined, mode: string | undefined): boolean {
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
  const addMatch = (target: Set<string>, agent: "echo" | "surf" | undefined, mode: string | undefined) => {
    const key = delegationMatchKey(agent, mode);

    if (key) {
      target.add(key);
    }
  };

  events.forEach((event) => {
    if (!event.userVisible || event.type !== "delegation.completed") {
      return;
    }

    if (event.status === "failed") {
      addMatch(failed, event.sourceAgent === "echo" || event.sourceAgent === "surf" ? event.sourceAgent : undefined, event.sourceMode);
      return;
    }

    if (event.status === "completed") {
      addMatch(completed, event.sourceAgent === "echo" || event.sourceAgent === "surf" ? event.sourceAgent : undefined, event.sourceMode);
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
  const fallback = normalizeStatus(event.status, event.type === "delegation.started" ? "running" : "completed");

  if (event.type !== "delegation.started" || (event.sourceAgent !== "echo" && event.sourceAgent !== "surf")) {
    return fallback;
  }

  if (hasDelegationMatch(outcomes.failed, event.sourceAgent, event.sourceMode)) {
    return "failed";
  }

  if (hasDelegationMatch(outcomes.completed, event.sourceAgent, event.sourceMode)) {
    return "completed";
  }

  return fallback;
}

function delegationRows(delegations: HermesCmoDelegationSummaryItem[], hasDelegationEvents: boolean): ActivityRow[] {
  if (hasDelegationEvents) {
    return [];
  }

  return delegations.flatMap((delegation, index) => {
    const label = agentLabel(delegation.targetAgent);
    const status = normalizeStatus(delegation.status, "completed");

    return [
      {
        key: `delegation-call-${delegation.delegationId}-${index}`,
        label: `Calling ${label}`,
        status: status === "failed" ? "completed" : status,
        detail: delegation.objective,
      },
      {
        key: `delegation-result-${delegation.delegationId}-${index}`,
        label: status === "failed" ? `${label} failed` : `${label} completed`,
        status,
        detail: delegation.failureReason ?? delegation.summary,
      },
    ];
  });
}

function activityRows(message: CMOChatMessage | undefined, running: boolean): ActivityRow[] {
  if (running) {
    return [
      {
        key: "optimistic-cmo-analyzing",
        label: "CMO analyzing",
        status: "running",
        detail: "Preparing the CMO runtime request.",
      },
    ];
  }

  const events = message?.activityEvents ?? message?.hermesCmoMetadata?.activityEvents ?? [];
  const delegations = message?.delegationSummary ?? message?.hermesCmoMetadata?.delegationSummary ?? [];
  const rows: ActivityRow[] = [];
  const firstCmoEvent = events.find((event) => event.userVisible && event.sourceAgent === "cmo");
  const delegationEvents = events.filter((event) => event.userVisible && (event.type === "delegation.started" || event.type === "delegation.completed"));
  const hasDelegationEvents = delegationEvents.length > 0;
  const delegationOutcomes = delegationOutcomeSets(events, delegations);

  if (firstCmoEvent || events.length > 0 || delegations.length > 0 || message?.currentStep || message?.hermesCmoMetadata?.currentStep) {
    rows.push({
      key: "cmo-analyzing",
      label: "CMO analyzing",
      status: "completed",
      detail: firstCmoEvent?.message,
    });
  }

  rows.push(
    ...delegationEvents.map((event, index): ActivityRow => ({
      key: `${event.eventId}-${index}`,
      label: eventLabel(event),
      status: displayStatusForEvent(event, delegationOutcomes),
      detail: event.message,
    })),
  );

  rows.push(...delegationRows(delegations, hasDelegationEvents));

  if (rows.length > 0) {
    const currentStep = message?.currentStep ?? message?.hermesCmoMetadata?.currentStep;
    const finalStatus = rows.some((row) => row.status === "failed") ? "failed" : "completed";

    rows.push({
      key: "cmo-synthesizing",
      label: "CMO synthesizing final answer",
      status: finalStatus,
      detail: currentStep,
    });
  }

  return rows;
}

function statusVariant(status: ActivityStatus): "green" | "orange" | "red" | "slate" | "blue" {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "running") return "blue";
  if (status === "waiting") return "orange";
  return "slate";
}

function statusIcon(status: ActivityStatus) {
  if (status === "completed") return <icons.CheckCircle2 className="size-3.5" />;
  if (status === "failed") return <icons.AlertTriangle className="size-3.5" />;
  if (status === "running") return <icons.RefreshCw className="size-3.5 animate-spin" />;
  if (status === "waiting") return <icons.Clock3 className="size-3.5" />;
  return <icons.Activity className="size-3.5" />;
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
    ? "CMO analyzing"
    : message?.currentStep ?? message?.hermesCmoMetadata?.currentStep ?? rows[rows.length - 1]?.label;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
          <Badge variant={statusVariant(status)}>{status}</Badge>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {rows.map((row) => (
          <div key={row.key} className="flex min-w-0 items-start gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-100">
            <span
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                row.status === "completed" ? "bg-emerald-50 text-emerald-700" : null,
                row.status === "failed" ? "bg-red-50 text-red-700" : null,
                row.status === "running" ? "bg-blue-50 text-blue-700" : null,
                row.status === "waiting" ? "bg-orange-50 text-orange-700" : null,
                row.status === "skipped" ? "bg-slate-100 text-slate-500" : null,
              )}
            >
              {statusIcon(row.status)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-900">{row.label}</span>
                <Badge className="px-2 py-0.5" variant={statusVariant(row.status)}>{row.status}</Badge>
              </div>
              {row.detail ? <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-600">{row.detail}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
