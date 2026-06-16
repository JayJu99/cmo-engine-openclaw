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

export function createLensReadoutContext(readout: LensReadout): LensReadoutContext {
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
    metricHighlights: compactMetricHighlights(readout),
    deterministicFindings: compactFindings(readout),
    recommendedActions: compactRecommendedActions(readout),
    limitations: [...readout.limitations],
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
