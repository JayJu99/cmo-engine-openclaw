import "server-only";

import {
  getLensReadoutForApp,
  type LensDeterministicFinding,
  type LensMetricHighlight,
  type LensReadout,
  type LensReadoutRecommendedAction,
} from "@/lib/cmo/lens-readout";
import type { WorkspaceGa4MetricRangeKey } from "@/lib/cmo/workspace-metric-snapshots";

export type LensReadoutContextContract = "lens.readout_context.v1";

export interface LensReadoutContext {
  contract: LensReadoutContextContract;
  readoutContract: "lens.readout.v1";
  appId: string;
  workspaceId: string;
  tenantId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
  generatedAt: string;
  sourceSnapshotIds: string[];
  status: {
    overall: LensReadout["status"]["overall"];
    dataStatus: LensReadout["status"]["dataStatus"];
    canAnswerBasicPerformance: boolean;
    canAnswerActivation: boolean;
    canAnswerRetention: boolean;
    canCompareTrend: boolean;
  };
  headline: LensReadout["headline"];
  metricHighlights: LensMetricHighlight[];
  deterministicFindings: LensDeterministicFinding[];
  recommendedActions: LensReadoutRecommendedAction[];
  limitations: string[];
  factsForModel: string[];
  groundingRules: string[];
}

export const LENS_READOUT_CONTEXT_GROUNDING_RULES = [
  "Use Lens readout facts as evidence for app performance questions.",
  "Do not treat Active Users as Activated Users.",
  "Do not treat Engagement Rate as Activation Rate.",
  "Do not invent activation or retention metrics when definition_needed.",
] as const;

export function isCmoLensDirectContextEnabled(): boolean {
  return process.env.CMO_LENS_DIRECT_CONTEXT_ENABLED === "true";
}

export interface LensReadoutContextResult {
  context: LensReadoutContext | null;
  warning?: {
    code: "lens_readout_context_unavailable";
    message: string;
  };
}

function compactMetricHighlights(readout: LensReadout): LensMetricHighlight[] {
  return readout.metricHighlights.map((metric) => ({
    key: metric.key,
    label: metric.label,
    value: metric.value,
    displayValue: metric.displayValue,
    unit: metric.unit,
    role: metric.role,
    source: metric.source,
  }));
}

function compactFindings(readout: LensReadout): LensDeterministicFinding[] {
  return readout.deterministicFindings.map((finding) => ({
    key: finding.key,
    type: finding.type,
    severity: finding.severity,
    title: finding.title,
    body: finding.body,
  }));
}

function compactRecommendedActions(readout: LensReadout): LensReadoutRecommendedAction[] {
  return readout.recommendedActions.map((action) => ({
    key: action.key,
    label: action.label,
    priority: action.priority,
    reason: action.reason,
  }));
}

function factDisplayValue(metric: LensMetricHighlight): string {
  if (metric.unit === "ratio") {
    return metric.displayValue;
  }

  const abs = Math.abs(metric.value);

  if (abs >= 1_000_000) {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(metric.value / 1_000_000)}M`;
  }

  if (abs >= 10_000) {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(metric.value / 1_000)}K`;
  }

  return metric.displayValue;
}

function factsForModel(readout: LensReadout, highlights: LensMetricHighlight[]): string[] {
  const facts = highlights.map((metric) => `For ${readout.range.key}, GA4 ${metric.label} = ${factDisplayValue(metric)}.`);

  if (!readout.status.canAnswerActivation) {
    facts.push("Activation metrics are not configured.");
  }

  if (!readout.status.canAnswerRetention) {
    facts.push("D1/D7 retention metrics are not configured.");
  }

  return facts;
}

export function createLensReadoutContext(readout: LensReadout): LensReadoutContext {
  const metricHighlights = compactMetricHighlights(readout);

  return {
    contract: "lens.readout_context.v1",
    readoutContract: readout.contract,
    appId: readout.appId,
    workspaceId: readout.workspaceId,
    tenantId: readout.tenantId,
    rangeKey: readout.range.key,
    generatedAt: readout.generatedAt,
    sourceSnapshotIds: readout.basis.sourceSnapshotIds,
    status: {
      overall: readout.status.overall,
      dataStatus: readout.status.dataStatus,
      canAnswerBasicPerformance: readout.status.canAnswerBasicPerformance,
      canAnswerActivation: readout.status.canAnswerActivation,
      canAnswerRetention: readout.status.canAnswerRetention,
      canCompareTrend: readout.status.canCompareTrend,
    },
    headline: readout.headline,
    metricHighlights,
    deterministicFindings: compactFindings(readout),
    recommendedActions: compactRecommendedActions(readout),
    limitations: [...readout.limitations],
    factsForModel: factsForModel(readout, metricHighlights),
    groundingRules: [...LENS_READOUT_CONTEXT_GROUNDING_RULES],
  };
}

export async function getLensReadoutContextForApp(input: {
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
}): Promise<LensReadoutContext> {
  const readout = await getLensReadoutForApp({
    appId: input.appId,
    rangeKey: input.rangeKey,
  });

  return createLensReadoutContext(readout);
}

export async function getLensReadoutContextForAppSafe(input: {
  appId: string;
  rangeKey: WorkspaceGa4MetricRangeKey;
}): Promise<LensReadoutContextResult> {
  try {
    return {
      context: await getLensReadoutContextForApp(input),
    };
  } catch (error) {
    return {
      context: null,
      warning: {
        code: "lens_readout_context_unavailable",
        message: error instanceof Error ? error.message : "Lens readout context unavailable.",
      },
    };
  }
}
