import {
  CMO_SCHEMA_VERSION,
  type CmoAction,
  type CmoAgent,
  type CmoPriority,
  type CmoReport,
  type CmoRun,
  type CmoSignal,
  type CmoStatus,
  type CmoSummary,
  type CmoTone,
  type CmoVaultItem,
} from "@/lib/cmo/types";
import {
  actions as fallbackActions,
  agents as fallbackAgents,
  reports as fallbackReports,
  signals as fallbackSignals,
  vaultItems as fallbackVault,
} from "@/components/dashboard/data";

const priorities = new Set(["High", "Medium", "Low", "Opportunity"]);
const tones = new Set(["violet", "green", "blue", "orange", "pink", "slate", "red"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function priorityValue(value: unknown, fallback: CmoPriority): CmoPriority {
  return typeof value === "string" && priorities.has(value) ? (value as CmoPriority) : fallback;
}

function toneValue(value: unknown, fallback: CmoTone): CmoTone {
  return typeof value === "string" && tones.has(value) ? (value as CmoTone) : fallback;
}

function statusValue(value: unknown, fallback: CmoStatus): CmoStatus {
  return stringValue(value, fallback) as CmoStatus;
}

function withVersion<T extends object>(value: T): T & { schema_version: typeof CMO_SCHEMA_VERSION } {
  return { schema_version: CMO_SCHEMA_VERSION, ...value };
}

function normalizeSummary(value: unknown): CmoSummary {
  const record = isRecord(value) ? value : {};
  return withVersion({
    title: stringValue(record.title, "Today's CMO Brief"),
    market_sentiment: stringValue(record.market_sentiment, "Bullish"),
    content_momentum: stringValue(record.content_momentum, "Improving"),
    top_opportunity: stringValue(record.top_opportunity, "Stock trading campaign"),
    risk: stringValue(record.risk, "Low engagement on educational posts"),
    next_action: stringValue(record.next_action, "Approve 3 content drafts"),
  });
}

export function normalizeActions(value: unknown): CmoAction[] {
  const source = Array.isArray(value) && value.length ? value : fallbackActions;
  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return withVersion({
      id: stringValue(record.id, `act_${String(index + 1).padStart(3, "0")}`),
      title: stringValue(record.title, fallbackActions[index % fallbackActions.length].title),
      summary: stringValue(record.summary, fallbackActions[index % fallbackActions.length].summary),
      priority: priorityValue(record.priority, fallbackActions[index % fallbackActions.length].priority as CmoPriority),
      source: stringValue(record.source, fallbackActions[index % fallbackActions.length].source),
      agent: stringValue(record.agent, fallbackActions[index % fallbackActions.length].agent),
      time: stringValue(record.time, fallbackActions[index % fallbackActions.length].time),
      type: stringValue(record.type, fallbackActions[index % fallbackActions.length].type),
    });
  });
}

export function normalizeSignals(value: unknown): CmoSignal[] {
  const source = Array.isArray(value) && value.length ? value : fallbackSignals;
  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return withVersion({
      id: stringValue(record.id, `sig_${String(index + 1).padStart(3, "0")}`),
      title: stringValue(record.title, fallbackSignals[index % fallbackSignals.length].title),
      summary: stringValue(record.summary, fallbackSignals[index % fallbackSignals.length].summary),
      category: stringValue(record.category, fallbackSignals[index % fallbackSignals.length].category),
      source: stringValue(record.source, fallbackSignals[index % fallbackSignals.length].source),
      severity: priorityValue(record.severity, fallbackSignals[index % fallbackSignals.length].severity as CmoPriority),
      time: stringValue(record.time, fallbackSignals[index % fallbackSignals.length].time),
    });
  });
}

export function normalizeAgents(value: unknown): CmoAgent[] {
  const source = Array.isArray(value) && value.length ? value : fallbackAgents;
  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    return withVersion({
      id: stringValue(record.id, `agent_${String(index + 1).padStart(3, "0")}`),
      name: stringValue(record.name, fallbackAgents[index % fallbackAgents.length].name),
      codename: stringValue(record.codename, fallbackAgents[index % fallbackAgents.length].codename),
      status: statusValue(record.status, fallbackAgents[index % fallbackAgents.length].status as CmoStatus),
      tone: toneValue(record.tone, fallbackAgents[index % fallbackAgents.length].tone as CmoTone),
      progress: numberValue(record.progress, fallbackAgents[index % fallbackAgents.length].progress),
      description: stringValue(record.description, fallbackAgents[index % fallbackAgents.length].description),
      activity: stringValue(record.activity, fallbackAgents[index % fallbackAgents.length].activity),
      metricA: stringValue(record.metricA, fallbackAgents[index % fallbackAgents.length].metricA),
      metricB: stringValue(record.metricB, fallbackAgents[index % fallbackAgents.length].metricB),
    });
  });
}

export function normalizeReports(value: unknown): CmoReport[] {
  const source = Array.isArray(value) && value.length ? value : fallbackReports;
  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const fallback = fallbackReports[index % fallbackReports.length];
    const stats = Array.isArray(record.stats) ? record.stats.map((stat) => stringValue(stat, "-")).slice(0, 3) : fallback.stats;
    return withVersion({
      id: stringValue(record.id, `rep_${String(index + 1).padStart(3, "0")}`),
      title: stringValue(record.title, fallback.title),
      type: stringValue(record.type, fallback.type),
      meta: stringValue(record.meta, fallback.meta),
      stats: stats.length === 3 ? stats : fallback.stats,
      tone: toneValue(record.tone, fallback.tone as CmoTone),
    });
  });
}

export function normalizeVault(value: unknown): CmoVaultItem[] {
  const source = Array.isArray(value) && value.length ? value : fallbackVault;
  return source.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const fallback = fallbackVault[index % fallbackVault.length];
    return withVersion({
      id: stringValue(record.id, `vault_${String(index + 1).padStart(3, "0")}`),
      name: stringValue(record.name, fallback.name),
      type: stringValue(record.type, fallback.type),
      status: statusValue(record.status, fallback.status as CmoStatus),
      count: stringValue(record.count, fallback.count),
      tone: toneValue(record.tone, fallback.tone as CmoTone),
    });
  });
}

export function normalizeRun(value: unknown): CmoRun {
  const record = isRecord(value) ? value : {};
  const createdAt = stringValue(record.created_at, new Date(0).toISOString());

  return withVersion({
    run_id: stringValue(record.run_id, "run_fallback"),
    created_at: createdAt,
    workspace: stringValue(record.workspace, "Holdstation"),
    status: statusValue(record.status, "mock"),
    summary: normalizeSummary(record.summary),
    actions: normalizeActions(record.actions),
    signals: normalizeSignals(record.signals),
    agents: normalizeAgents(record.agents),
    reports: normalizeReports(record.reports),
    vault: normalizeVault(record.vault),
  });
}

export function validateNormalizedRun(run: CmoRun): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (run.schema_version !== CMO_SCHEMA_VERSION) {
    errors.push(`Unsupported schema_version: ${run.schema_version}`);
  }

  if (!run.run_id.trim()) {
    errors.push("run_id is required");
  }

  if (Number.isNaN(Date.parse(run.created_at))) {
    errors.push("created_at must be a valid ISO timestamp");
  }

  if (!run.summary.title.trim()) {
    errors.push("summary.title is required");
  }

  if (!Array.isArray(run.actions) || !Array.isArray(run.signals)) {
    errors.push("actions and signals must be arrays");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function createFallbackRun(): CmoRun {
  return normalizeRun({
    run_id: "run_fallback",
    created_at: new Date(0).toISOString(),
    workspace: "Holdstation",
    status: "mock",
  });
}
