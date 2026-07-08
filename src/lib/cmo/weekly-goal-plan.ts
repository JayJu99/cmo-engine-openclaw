import type { CmoGoalBaselineTargetV1 } from "@/lib/cmo/goal-baseline-target";
import type { CmoGoalV1 } from "@/lib/cmo/goal-state";
import type { LensMetricGoalKindV1, LensMetricSourceResolutionV1 } from "@/lib/cmo/lens-metric-source-resolution";

export const CMO_WEEKLY_GOAL_PLAN_CONTRACT = "cmo.weekly_goal_plan.v1" as const;

export type CmoWeeklyGoalPlanContractV1 = typeof CMO_WEEKLY_GOAL_PLAN_CONTRACT;
export type CmoWeeklyGoalPlanStatusV1 =
  | "ready_for_approval"
  | "needs_baseline"
  | "needs_capability"
  | "estimated_plan_only"
  | "unsupported";
export type CmoWeeklyGoalDraftApprovalStatusV1 = "draft_requires_review";
export type CmoWeeklyGoalPlanApprovalTypeV1 = "plan";
export type CmoWeeklyGoalKindV1 = LensMetricGoalKindV1 | "unsupported";

export interface AssembleCmoWeeklyGoalPlanInputV1 {
  goal?: CmoGoalV1 | null;
  baselineTarget?: CmoGoalBaselineTargetV1 | null;
  metricSourceResolution?: LensMetricSourceResolutionV1 | null;
  startDate?: string | null;
  now?: string | null;
}

export interface CmoWeeklyGoalPlanSourceContractsV1 {
  goal_contract: "cmo.goal.v1" | null;
  baseline_target_contract: "cmo.goal_baseline_target.v1" | null;
  metric_source_resolution_contract: "lens.metric_source_resolution.v1" | null;
}

export interface CmoWeeklyGoalPlanSummaryV1 {
  user_visible_title: string;
  user_visible_body: string;
  goal_summary: string;
  baseline_summary: string;
  target_summary: string;
  measurement_summary: string;
}

export interface CmoWeeklyGoalUtmIntentV1 {
  applies_to_goal: boolean;
  required_for_real_measurement: boolean;
  source_ready: boolean;
  campaign_slug: string;
  source_hint: string;
  medium_hint: string;
  content_hint: string;
  notes: string[];
}

export interface CmoWeeklyGoalDraftBriefV1 {
  draft_id: string;
  day_index: number;
  channel: string;
  objective: string;
  angle: string;
  key_message: string;
  cta_intent: string;
  measurement_intent: string;
  utm_intent: CmoWeeklyGoalUtmIntentV1 | null;
  dependencies: string[];
  missing_capabilities: string[];
  approval_status: CmoWeeklyGoalDraftApprovalStatusV1;
}

export interface CmoWeeklyGoalPlanDayV1 {
  day_index: number;
  date_label: string;
  relative_label: string;
  objective: string;
  channel_focus: string;
  content_angle: string;
  draft_briefs: CmoWeeklyGoalDraftBriefV1[];
  measurement_intent: string;
  dependencies: string[];
  missing_capabilities: string[];
}

export interface CmoWeeklyGoalBriefsByChannelV1 {
  channel: string;
  briefs: CmoWeeklyGoalDraftBriefV1[];
}

export interface CmoWeeklyGoalDraftAssemblyV1 {
  briefs_by_channel: CmoWeeklyGoalBriefsByChannelV1[];
  suggested_post_count: number;
  utm_intent: CmoWeeklyGoalUtmIntentV1 | null;
  handoff_hints: string[];
}

export interface CmoWeeklyGoalPlanApprovalV1 {
  approval_required: true;
  approval_type: CmoWeeklyGoalPlanApprovalTypeV1;
  approval_prompt: string;
  execution_approval_required_separately: true;
}

export interface CmoWeeklyGoalPlanGuardrailsV1 {
  no_execution: true;
  no_publish: true;
  no_schedule: true;
  approval_required_before_execution: true;
  estimated_metrics_must_be_labeled: true;
}

export interface CmoWeeklyGoalPlanV1 {
  contract: CmoWeeklyGoalPlanContractV1;
  goal_id: string | null;
  workspace_id: string | null;
  app_id: string | null;
  session_id: string | null;
  source_contracts: CmoWeeklyGoalPlanSourceContractsV1;
  status: CmoWeeklyGoalPlanStatusV1;
  plan_summary: CmoWeeklyGoalPlanSummaryV1;
  days: CmoWeeklyGoalPlanDayV1[];
  draft_assembly: CmoWeeklyGoalDraftAssemblyV1;
  approval: CmoWeeklyGoalPlanApprovalV1;
  guardrails: CmoWeeklyGoalPlanGuardrailsV1;
}

interface CmoWeeklyGoalPlanContextV1 {
  goal: CmoGoalV1 | null;
  baselineTarget: CmoGoalBaselineTargetV1 | null;
  metricSourceResolution: LensMetricSourceResolutionV1 | null;
  status: CmoWeeklyGoalPlanStatusV1;
  goalKind: CmoWeeklyGoalKindV1;
  metricLabel: string;
  startDate: string | null;
  missingCapabilities: string[];
  dependencies: string[];
  utmIntent: CmoWeeklyGoalUtmIntentV1 | null;
}

interface DayPlanTemplate {
  objective: string;
  angle: string;
}

const PLAN_DAYS = 7;
const SAFE_TEXT_PATTERN =
  /(?:\b(?:api[_-]?key|apiKey|authorization|bearer|cookie|headers?|access[_-]?token|refresh[_-]?token|refreshToken|secret)\b|raw[\s_-]?ga4|rawGa4Response)/i;
const SUPPORTED_GOAL_KINDS = new Set<CmoWeeklyGoalKindV1>([
  "traffic",
  "facebook_engagement",
  "x_engagement",
  "platform_engagement",
  "conversion",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCmoGoal(value: unknown): value is CmoGoalV1 {
  return isRecord(value) && value.contract === "cmo.goal.v1";
}

function isCmoGoalBaselineTarget(value: unknown): value is CmoGoalBaselineTargetV1 {
  return isRecord(value) &&
    value.contract === "cmo.goal_baseline_target.v1" &&
    isRecord(value.metric) &&
    isRecord(value.baseline) &&
    isRecord(value.target) &&
    isRecord(value.missing) &&
    isRecord(value.guardrails);
}

function isLensMetricSourceResolution(value: unknown): value is LensMetricSourceResolutionV1 {
  return isRecord(value) && value.contract === "lens.metric_source_resolution.v1";
}

function safeString(value: unknown, fallback: string | null = null, maxLength = 240): string | null {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";

  if (!text || SAFE_TEXT_PATTERN.test(text)) {
    return fallback;
  }

  return text;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeGoalKind(value: unknown): CmoWeeklyGoalKindV1 {
  if (
    value === "traffic" ||
    value === "facebook_engagement" ||
    value === "x_engagement" ||
    value === "platform_engagement" ||
    value === "conversion" ||
    value === "activation" ||
    value === "unknown"
  ) {
    return value;
  }

  if (value === "unsupported") {
    return "unsupported";
  }

  return "unknown";
}

function compactId(value: string | null | undefined, fallback: string): string {
  const safeValue = (value ?? "").replace(/[^A-Za-z0-9_.-]/g, "-").replace(/-+/g, "-").slice(0, 80);

  return safeValue || fallback;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "weekly_goal_plan";
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return String(Math.round((value + Number.EPSILON) * 100) / 100);
}

function formatMetricValue(value: number | null, unit: string): string {
  return value === null ? `no ${unit} value` : `${formatNumber(value)} ${unit}`;
}

function formatDeltaPercent(value: number | null): string {
  return value === null ? "" : ` (${formatNumber(value)}%)`;
}

function metricLabelFromKey(key: string | null | undefined): string {
  const safeKey = safeString(key, "Unknown metric", 120) ?? "Unknown metric";

  if (safeKey === "website_traffic") {
    return "Website traffic";
  }

  if (safeKey === "facebook_engagement") {
    return "Facebook engagement";
  }

  if (safeKey === "x_engagement") {
    return "X engagement";
  }

  if (safeKey === "platform_engagement") {
    return "Platform engagement";
  }

  if (safeKey === "conversions") {
    return "Conversions";
  }

  return safeKey
    .split("_")
    .filter(Boolean)
    .map((part, index) => (index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(" ") || "Unknown metric";
}

function sourceLabel(value: string | null | undefined): string {
  if (value === "ga4_utm") {
    return "GA4/UTM";
  }

  if (value === "meta_page_insights") {
    return "Meta Page Insights";
  }

  if (value === "x_post_insights") {
    return "X Post Insights";
  }

  if (value === "x_api") {
    return "X API";
  }

  if (value === "manual_input") {
    return "manual input";
  }

  if (value === "estimated") {
    return "estimated input";
  }

  return "unknown source";
}

function firstDateOnly(...values: Array<unknown>): string | null {
  for (const value of values) {
    const text = safeString(value, null, 40);

    if (text && parseDateOnly(text)) {
      return text;
    }
  }

  return null;
}

function parseDateOnly(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day };
}

function dateToEpochDay(value: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / 86_400_000);
}

function epochDayToDate(value: number): string {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

function dateLabelForDay(startDate: string | null, dayIndex: number, baselineTarget: CmoGoalBaselineTargetV1 | null): string {
  const targetDate = baselineTarget?.target.daily_targets.find((item) => item.day_index === dayIndex)?.date ?? null;

  if (targetDate) {
    return targetDate;
  }

  const parsedStart = parseDateOnly(startDate);

  if (!parsedStart) {
    return `Day ${dayIndex}`;
  }

  return epochDayToDate(dateToEpochDay(parsedStart) + dayIndex - 1);
}

function isSupportedGoalKind(goalKind: CmoWeeklyGoalKindV1): boolean {
  return SUPPORTED_GOAL_KINDS.has(goalKind);
}

function primarySourceReady(sourceResolution: LensMetricSourceResolutionV1 | null): boolean {
  const status = sourceResolution?.primary_source?.status;

  return status === "ready" || status === "partial";
}

function blockingMissingCapabilities(
  baselineTarget: CmoGoalBaselineTargetV1 | null,
  sourceResolution: LensMetricSourceResolutionV1 | null,
): string[] {
  const fromBaseline = safeString(baselineTarget?.missing.missing_capability_request?.safe_user_message, null, 240);
  const fromResolution = (sourceResolution?.missing_requirements ?? [])
    .filter((requirement) => requirement.severity === "blocking")
    .map((requirement) => safeString(requirement.safe_user_message, null, 240))
    .filter((item): item is string => Boolean(item));
  const values = [fromBaseline, ...fromResolution].filter((item): item is string => Boolean(item));

  return Array.from(new Set(values));
}

export function cmoWeeklyGoalPlanStatusFromBaselineTarget(input: {
  goal?: CmoGoalV1 | null;
  baselineTarget?: CmoGoalBaselineTargetV1 | null;
  metricSourceResolution?: LensMetricSourceResolutionV1 | null;
}): CmoWeeklyGoalPlanStatusV1 {
  const goal = isCmoGoal(input.goal) ? input.goal : null;
  const baselineTarget = isCmoGoalBaselineTarget(input.baselineTarget) ? input.baselineTarget : null;
  const sourceResolution = isLensMetricSourceResolution(input.metricSourceResolution)
    ? input.metricSourceResolution
    : isLensMetricSourceResolution(goal?.metric_source_resolution)
      ? goal.metric_source_resolution
      : null;
  const goalKind = normalizeGoalKind(goal?.normalized_goal_kind ?? baselineTarget?.metric.kind ?? sourceResolution?.goal_kind);

  if (!goal || !isSupportedGoalKind(goalKind) || baselineTarget?.metric.kind === "unsupported" || baselineTarget?.metric.kind === "unknown") {
    return "unsupported";
  }

  if (!baselineTarget) {
    return "needs_baseline";
  }

  if (baselineTarget.target.status === "unsupported" || baselineTarget.target.status === "invalid_goal") {
    return "unsupported";
  }

  if (baselineTarget.baseline.status === "estimated" || baselineTarget.baseline.is_estimated || baselineTarget.baseline.planning_only) {
    return "estimated_plan_only";
  }

  if (baselineTarget.baseline.status === "missing_primary_source") {
    return blockingMissingCapabilities(baselineTarget, sourceResolution).length ? "needs_capability" : "needs_baseline";
  }

  if (baselineTarget.baseline.status === "manual_required" || baselineTarget.baseline.status === "unavailable") {
    return "needs_baseline";
  }

  if (baselineTarget.target.status === "needs_baseline") {
    return "needs_baseline";
  }

  if (baselineTarget.target.status !== "ready") {
    return "needs_baseline";
  }

  if (!primarySourceReady(sourceResolution) && baselineTarget.baseline.source_kind !== "manual_input") {
    return baselineTarget.baseline.status === "ready" ? "ready_for_approval" : "needs_capability";
  }

  return "ready_for_approval";
}

function missingCapabilitiesForStatus(input: {
  status: CmoWeeklyGoalPlanStatusV1;
  baselineTarget: CmoGoalBaselineTargetV1 | null;
  sourceResolution: LensMetricSourceResolutionV1 | null;
}): string[] {
  if (input.status === "needs_capability") {
    return blockingMissingCapabilities(input.baselineTarget, input.sourceResolution).length
      ? blockingMissingCapabilities(input.baselineTarget, input.sourceResolution)
      : ["Resolve the primary measurement capability before claiming a real baseline."];
  }

  if (input.status === "needs_baseline") {
    return ["Provide or resolve a baseline before approving target claims."];
  }

  if (input.status === "estimated_plan_only") {
    return ["Replace the estimated baseline with source truth before claiming measured performance."];
  }

  if (input.status === "unsupported") {
    return ["Use a supported normalized CMO goal kind before approving a weekly campaign plan."];
  }

  return [];
}

function dependenciesForStatus(status: CmoWeeklyGoalPlanStatusV1, baselineTarget: CmoGoalBaselineTargetV1 | null): string[] {
  const base = [
    "CMO plan approval",
    "Separate execution approval before any run, schedule, or publish step",
    "Human review of draft briefs before final copy or creative production",
  ];

  if (status === "ready_for_approval" && baselineTarget?.baseline.source_kind === "manual_input") {
    return [
      ...base,
      "Manual baseline owner confirmation",
    ];
  }

  if (status === "estimated_plan_only") {
    return [
      ...base,
      "Estimated baseline must remain labeled as planning-only",
    ];
  }

  if (status === "needs_capability") {
    return [
      ...base,
      "Primary measurement source resolution",
    ];
  }

  if (status === "needs_baseline") {
    return [
      ...base,
      "Baseline value and target confirmation",
    ];
  }

  if (status === "unsupported") {
    return [
      ...base,
      "Supported goal kind and metric resolution",
    ];
  }

  return base;
}

function channelSequence(goalKind: CmoWeeklyGoalKindV1): string[] {
  if (goalKind === "facebook_engagement") {
    return ["Facebook page", "Facebook page", "Facebook community", "Facebook page", "Facebook page", "Facebook community", "Facebook page"];
  }

  if (goalKind === "x_engagement") {
    return ["X organic", "X thread", "X reply prompt", "X proof post", "X link post", "X objection post", "X recap"];
  }

  if (goalKind === "platform_engagement") {
    return ["Facebook page", "X organic", "Community", "Facebook page", "X organic", "Community", "Weekly recap"];
  }

  if (goalKind === "conversion") {
    return ["Landing page", "Organic social", "Proof asset", "Owned audience", "Retargeting brief", "FAQ asset", "Weekly recap"];
  }

  if (goalKind === "traffic") {
    return ["Landing page", "X organic", "Facebook page", "Community", "Partner/referral", "Owned audience", "Weekly recap"];
  }

  return ["Goal clarification", "Measurement setup", "Audience definition", "Channel selection", "Offer framing", "Review checkpoint", "Plan recap"];
}

function dayTemplates(goalKind: CmoWeeklyGoalKindV1, metricLabel: string): DayPlanTemplate[] {
  if (goalKind === "traffic") {
    return [
      { objective: `Frame the weekly ${metricLabel.toLowerCase()} target and landing path.`, angle: "Baseline-to-target setup" },
      { objective: "Introduce the highest-intent reason to visit.", angle: "Audience problem and immediate payoff" },
      { objective: "Translate the offer into a clear social proof hook.", angle: "Proof-led traffic driver" },
      { objective: "Open a community prompt that points back to the measured path.", angle: "Conversation-to-click bridge" },
      { objective: "Package a partner or referral handoff brief.", angle: "Third-party relevance" },
      { objective: "Reinforce the visit intent for owned audiences.", angle: "Reminder and objection handling" },
      { objective: "Summarize the week and request approval for next-step execution.", angle: "Weekly recap and review" },
    ];
  }

  if (goalKind === "facebook_engagement") {
    return [
      { objective: `Set the ${metricLabel.toLowerCase()} target and review theme.`, angle: "Weekly engagement frame" },
      { objective: "Invite a low-friction reaction or comment.", angle: "Question-led participation" },
      { objective: "Turn a product use case into a shareable prompt.", angle: "Use-case discussion" },
      { objective: "Build trust with a proof or education angle.", angle: "Proof and credibility" },
      { objective: "Ask for a specific response tied to the goal.", angle: "Directed engagement" },
      { objective: "Handle a common objection in a reviewable draft.", angle: "Objection removal" },
      { objective: "Close the loop with a recap and next review request.", angle: "Weekly recap and review" },
    ];
  }

  if (goalKind === "x_engagement") {
    return [
      { objective: `Set the ${metricLabel.toLowerCase()} target and thread narrative.`, angle: "Weekly conversation frame" },
      { objective: "Publish a concise opinion prompt for replies.", angle: "Point-of-view prompt" },
      { objective: "Draft a thread skeleton that teaches the core use case.", angle: "Education thread" },
      { objective: "Prepare a proof-led post for reposts and saves.", angle: "Proof and credibility" },
      { objective: "Build a link-intent post without claiming measurement.", angle: "Action-oriented link bridge" },
      { objective: "Address a likely objection in short-form language.", angle: "Objection removal" },
      { objective: "Recap the week and request plan review.", angle: "Weekly recap and review" },
    ];
  }

  if (goalKind === "conversion") {
    return [
      { objective: `Set the ${metricLabel.toLowerCase()} target and conversion path.`, angle: "Baseline-to-target setup" },
      { objective: "Clarify the conversion promise and user fit.", angle: "Offer clarity" },
      { objective: "Show the path from interest to action.", angle: "Step-by-step education" },
      { objective: "Add proof that reduces conversion anxiety.", angle: "Proof and credibility" },
      { objective: "Draft a CTA-specific conversion brief.", angle: "Direct response" },
      { objective: "Answer the highest-friction question.", angle: "Friction removal" },
      { objective: "Summarize the conversion plan for approval.", angle: "Weekly recap and review" },
    ];
  }

  return [
    { objective: "Resolve the supported goal, metric, and approval path.", angle: "Goal clarification" },
    { objective: "Define the measurable audience and channel assumptions.", angle: "Measurement setup" },
    { objective: "Prepare a non-final brief once the goal is supported.", angle: "Draft skeleton" },
    { objective: "Identify proof or context needed for a usable plan.", angle: "Evidence gap" },
    { objective: "Define the CTA only after the metric is supported.", angle: "CTA placeholder" },
    { objective: "Review unresolved dependencies.", angle: "Approval readiness" },
    { objective: "Recap what must be resolved before plan approval.", angle: "Weekly recap and review" },
  ];
}

function ctaIntent(goalKind: CmoWeeklyGoalKindV1): string {
  if (goalKind === "traffic") {
    return "Visit the measured landing path after review.";
  }

  if (goalKind === "facebook_engagement") {
    return "React, comment, share, or answer the review prompt.";
  }

  if (goalKind === "x_engagement") {
    return "Reply, repost, bookmark, or click through after review.";
  }

  if (goalKind === "conversion") {
    return "Start the reviewed conversion path.";
  }

  if (goalKind === "platform_engagement") {
    return "Engage on the selected platform after review.";
  }

  return "Wait for supported goal resolution before final CTA selection.";
}

function baselineSummary(baselineTarget: CmoGoalBaselineTargetV1 | null): string {
  if (!baselineTarget) {
    return "Baseline: not assembled yet; no baseline value is claimed.";
  }

  const baseline = baselineTarget.baseline;
  const value = formatMetricValue(safeNumber(baseline.value), baseline.unit);

  if (baseline.status === "ready" && baseline.source_kind === "manual_input") {
    return `Baseline: ${value} from manual input, ${baseline.confidence} confidence. This is visible as manual and not claimed as connector truth.`;
  }

  if (baseline.status === "ready") {
    const truthLabel = baseline.is_real_measurement ? "real measurement" : "supplied baseline";

    return `Baseline: ${value} from ${sourceLabel(baseline.source_kind)} (${truthLabel}, ${baseline.confidence} confidence).`;
  }

  if (baseline.status === "estimated") {
    return `Baseline: ${value} from estimated input, low confidence, planning-only. It must stay labeled as estimated.`;
  }

  if (baseline.status === "missing_primary_source") {
    return "Baseline: missing primary source; no real baseline is claimed.";
  }

  if (baseline.status === "manual_required") {
    return "Baseline: manual input is required before target claims can be approved.";
  }

  return "Baseline: unavailable for this goal.";
}

function targetSummary(baselineTarget: CmoGoalBaselineTargetV1 | null): string {
  if (!baselineTarget) {
    return "Target: not assembled because the baseline/target contract is missing.";
  }

  const target = baselineTarget.target;
  const unit = baselineTarget.baseline.unit;

  if (target.status === "ready") {
    const targetValue = formatMetricValue(safeNumber(target.target_value), unit);
    const delta = formatMetricValue(safeNumber(target.delta_value), unit);
    const windowLabel = safeString(target.window?.label, "the target window", 120) ?? "the target window";

    return `Target: ${targetValue}, ${delta} change${formatDeltaPercent(target.delta_percent)} for ${windowLabel}.`;
  }

  if (target.status === "needs_baseline") {
    return "Target: needs baseline before the plan can claim a target lift.";
  }

  if (target.status === "invalid_goal") {
    return "Target: invalid goal input; plan cannot be approved as ready.";
  }

  return "Target: unsupported for this goal.";
}

function measurementSummary(input: {
  baselineTarget: CmoGoalBaselineTargetV1 | null;
  sourceResolution: LensMetricSourceResolutionV1 | null;
  missingCapabilities: string[];
  status: CmoWeeklyGoalPlanStatusV1;
}): string {
  if (input.status === "estimated_plan_only") {
    return "Measurement: estimated baseline only; all metric claims must remain labeled low-confidence and planning-only.";
  }

  if (input.missingCapabilities.length) {
    return `Measurement: capability gap visible; ${input.missingCapabilities.join(" ")}`;
  }

  const primary = input.sourceResolution?.primary_source;

  if (primary) {
    return `Measurement: primary source is ${sourceLabel(primary.source_type)} with ${primary.status} status.`;
  }

  if (input.baselineTarget?.baseline.source_kind === "manual_input") {
    return "Measurement: manual baseline is supplied; connector measurement is not claimed.";
  }

  return "Measurement: no primary source is attached to this assembly.";
}

function metricLabel(goal: CmoGoalV1 | null, baselineTarget: CmoGoalBaselineTargetV1 | null, sourceResolution: LensMetricSourceResolutionV1 | null): string {
  return safeString(baselineTarget?.metric.label, null, 120) ??
    metricLabelFromKey(goal?.resolved_metric ?? sourceResolution?.resolved_metric);
}

function startDateForPlan(input: {
  startDate?: unknown;
  now?: unknown;
  goal: CmoGoalV1 | null;
  baselineTarget: CmoGoalBaselineTargetV1 | null;
}): string | null {
  return firstDateOnly(
    input.startDate,
    input.baselineTarget?.target.window?.start_date,
    input.goal?.target_window?.start_date,
    input.now,
  );
}

export function createCmoWeeklyGoalUtmIntent(input: {
  goal: CmoGoalV1 | null;
  baselineTarget: CmoGoalBaselineTargetV1 | null;
  metricSourceResolution: LensMetricSourceResolutionV1 | null;
  startDate: string | null;
}): CmoWeeklyGoalUtmIntentV1 | null {
  const goalKind = normalizeGoalKind(input.goal?.normalized_goal_kind ?? input.baselineTarget?.metric.kind ?? input.metricSourceResolution?.goal_kind);

  if (goalKind !== "traffic") {
    return null;
  }

  const goalId = compactId(input.goal?.goal_id ?? input.baselineTarget?.goal_id ?? null, "goal");
  const sourceReady = input.metricSourceResolution?.primary_source?.source_type === "ga4_utm" &&
    primarySourceReady(input.metricSourceResolution);
  const campaignSlug = slug(`cmo_${goalId}_${input.startDate ?? "week"}`);

  return {
    applies_to_goal: true,
    required_for_real_measurement: true,
    source_ready: sourceReady || input.baselineTarget?.baseline.source_kind === "ga4_utm",
    campaign_slug: campaignSlug,
    source_hint: "set channel source during final review",
    medium_hint: "organic_social_or_owned",
    content_hint: "use day index and reviewed angle",
    notes: sourceReady || input.baselineTarget?.baseline.source_kind === "ga4_utm"
      ? ["UTM intent is included for reviewed traffic handoff; this contract does not create links or call GA4."]
      : ["GA4/UTM is intended for traffic proof but is not ready, so no real traffic baseline is claimed."],
  };
}

function dayMeasurementIntent(input: {
  dayIndex: number;
  status: CmoWeeklyGoalPlanStatusV1;
  baselineTarget: CmoGoalBaselineTargetV1 | null;
  utmIntent: CmoWeeklyGoalUtmIntentV1 | null;
}): string {
  if (input.status === "needs_capability") {
    return "Plan-only measurement intent; primary measurement capability must be resolved before claiming source truth.";
  }

  if (input.status === "needs_baseline") {
    return "Plan-only measurement intent; baseline is required before target performance can be claimed.";
  }

  if (input.status === "estimated_plan_only") {
    return "Estimated measurement intent; label all metrics as planning-only until source truth replaces the estimate.";
  }

  if (input.status === "unsupported") {
    return "Measurement intent blocked until a supported goal kind is resolved.";
  }

  const dailyTarget = input.baselineTarget?.target.daily_targets.find((item) => item.day_index === input.dayIndex);

  if (dailyTarget) {
    return `Track progress toward ${formatMetricValue(dailyTarget.target_value, input.baselineTarget?.baseline.unit ?? "count")} cumulative target for this day.`;
  }

  if (input.utmIntent) {
    return "Track reviewed traffic handoff with UTM intent after plan approval; this assembly does not call measurement APIs.";
  }

  return "Track contribution against the approved weekly target after separate execution approval.";
}

function keyMessage(input: {
  goalKind: CmoWeeklyGoalKindV1;
  metricLabel: string;
  baselineTarget: CmoGoalBaselineTargetV1 | null;
  status: CmoWeeklyGoalPlanStatusV1;
  angle: string;
}): string {
  if (input.status === "unsupported") {
    return "Resolve the supported goal and measurement source before final copy is drafted.";
  }

  const baseline = baselineSummary(input.baselineTarget);
  const target = targetSummary(input.baselineTarget);

  if (input.status === "estimated_plan_only") {
    return `${input.metricLabel}: ${input.angle}. ${baseline} ${target} Keep estimates labeled.`;
  }

  if (input.status === "needs_capability" || input.status === "needs_baseline") {
    return `${input.metricLabel}: ${input.angle}. Build the draft skeleton, but do not claim measured lift until baseline and source gaps are resolved.`;
  }

  return `${input.metricLabel}: ${input.angle}. Move from approved baseline context toward the weekly target.`;
}

export function createCmoWeeklyGoalDraftBrief(input: {
  goalId: string | null;
  dayIndex: number;
  channel: string;
  objective: string;
  angle: string;
  metricLabel: string;
  goalKind: CmoWeeklyGoalKindV1;
  status: CmoWeeklyGoalPlanStatusV1;
  baselineTarget: CmoGoalBaselineTargetV1 | null;
  measurementIntent: string;
  utmIntent: CmoWeeklyGoalUtmIntentV1 | null;
  dependencies: string[];
  missingCapabilities: string[];
}): CmoWeeklyGoalDraftBriefV1 {
  const goalId = compactId(input.goalId, "goal");
  const channelId = slug(input.channel);

  return {
    draft_id: `${goalId}_day_${input.dayIndex}_${channelId}`,
    day_index: input.dayIndex,
    channel: input.channel,
    objective: input.objective,
    angle: input.angle,
    key_message: keyMessage({
      goalKind: input.goalKind,
      metricLabel: input.metricLabel,
      baselineTarget: input.baselineTarget,
      status: input.status,
      angle: input.angle,
    }),
    cta_intent: ctaIntent(input.goalKind),
    measurement_intent: input.measurementIntent,
    utm_intent: input.utmIntent,
    dependencies: input.dependencies,
    missing_capabilities: input.missingCapabilities,
    approval_status: "draft_requires_review",
  };
}

export function createCmoWeeklyGoalPlanDays(context: CmoWeeklyGoalPlanContextV1): CmoWeeklyGoalPlanDayV1[] {
  const channels = channelSequence(context.goalKind);
  const templates = dayTemplates(context.goalKind, context.metricLabel);
  const days: CmoWeeklyGoalPlanDayV1[] = [];

  for (let dayIndex = 1; dayIndex <= PLAN_DAYS; dayIndex += 1) {
    const channel = channels[dayIndex - 1] ?? channels[0] ?? "Review";
    const template = templates[dayIndex - 1] ?? templates[0];
    const measurementIntent = dayMeasurementIntent({
      dayIndex,
      status: context.status,
      baselineTarget: context.baselineTarget,
      utmIntent: context.utmIntent,
    });
    const draftBrief = createCmoWeeklyGoalDraftBrief({
      goalId: context.goal?.goal_id ?? context.baselineTarget?.goal_id ?? null,
      dayIndex,
      channel,
      objective: template.objective,
      angle: template.angle,
      metricLabel: context.metricLabel,
      goalKind: context.goalKind,
      status: context.status,
      baselineTarget: context.baselineTarget,
      measurementIntent,
      utmIntent: context.utmIntent,
      dependencies: context.dependencies,
      missingCapabilities: context.missingCapabilities,
    });

    days.push({
      day_index: dayIndex,
      date_label: dateLabelForDay(context.startDate, dayIndex, context.baselineTarget),
      relative_label: `Day ${dayIndex}`,
      objective: template.objective,
      channel_focus: channel,
      content_angle: template.angle,
      draft_briefs: [draftBrief],
      measurement_intent: measurementIntent,
      dependencies: context.dependencies,
      missing_capabilities: context.missingCapabilities,
    });
  }

  return days;
}

function briefsByChannel(days: CmoWeeklyGoalPlanDayV1[]): CmoWeeklyGoalBriefsByChannelV1[] {
  const grouped = new Map<string, CmoWeeklyGoalDraftBriefV1[]>();

  for (const brief of days.flatMap((day) => day.draft_briefs)) {
    grouped.set(brief.channel, [...(grouped.get(brief.channel) ?? []), brief]);
  }

  return Array.from(grouped.entries()).map(([channel, briefs]) => ({ channel, briefs }));
}

function createDraftAssembly(input: {
  days: CmoWeeklyGoalPlanDayV1[];
  utmIntent: CmoWeeklyGoalUtmIntentV1 | null;
  status: CmoWeeklyGoalPlanStatusV1;
}): CmoWeeklyGoalDraftAssemblyV1 {
  const draftCount = input.days.reduce((total, day) => total + day.draft_briefs.length, 0);

  return {
    briefs_by_channel: briefsByChannel(input.days),
    suggested_post_count: draftCount,
    utm_intent: input.utmIntent,
    handoff_hints: [
      "Use these as review briefs or skeletons, not final scheduled posts.",
      "Final copy, creative generation, scheduling, publishing, and execution belong to a later separately approved step.",
      input.status === "estimated_plan_only"
        ? "Keep estimated metrics labeled in every downstream handoff."
        : "Preserve baseline, target, and missing-capability labels in downstream handoff.",
    ],
  };
}

function statusLabel(status: CmoWeeklyGoalPlanStatusV1): string {
  if (status === "ready_for_approval") {
    return "ready for plan approval";
  }

  if (status === "needs_capability") {
    return "needs measurement capability";
  }

  if (status === "needs_baseline") {
    return "needs baseline";
  }

  if (status === "estimated_plan_only") {
    return "estimated plan only";
  }

  return "unsupported";
}

export function createCmoWeeklyGoalPlanApprovalPrompt(input: {
  status: CmoWeeklyGoalPlanStatusV1;
  metricLabel: string;
}): string {
  return [
    `Review the 7-day ${input.metricLabel} plan marked ${statusLabel(input.status)}.`,
    "Approve only if the plan direction and draft briefs are acceptable.",
    "Plan approval does not approve execution, scheduling, publishing, paid generation, or connector activity.",
  ].join(" ");
}

export function createCmoWeeklyGoalPlanSummary(context: CmoWeeklyGoalPlanContextV1): CmoWeeklyGoalPlanSummaryV1 {
  const goalText = safeString(context.goal?.raw_user_message, null, 260);
  const goalSummary = goalText
    ? `Goal request: ${goalText}`
    : `Goal metric: ${context.metricLabel}.`;
  const baseline = baselineSummary(context.baselineTarget);
  const target = targetSummary(context.baselineTarget);
  const measurement = measurementSummary({
    baselineTarget: context.baselineTarget,
    sourceResolution: context.metricSourceResolution,
    missingCapabilities: context.missingCapabilities,
    status: context.status,
  });
  const statusText = statusLabel(context.status);
  const userVisibleTitle = `${context.metricLabel} weekly plan: ${statusText}`;
  const userVisibleBody = [
    goalSummary,
    baseline,
    target,
    measurement,
    "Approval note: approving this plan only approves the plan and draft direction; execution approval remains separate.",
  ].join("\n");

  return {
    user_visible_title: userVisibleTitle,
    user_visible_body: userVisibleBody,
    goal_summary: goalSummary,
    baseline_summary: baseline,
    target_summary: target,
    measurement_summary: measurement,
  };
}

function sourceContracts(input: {
  goal: CmoGoalV1 | null;
  baselineTarget: CmoGoalBaselineTargetV1 | null;
  metricSourceResolution: LensMetricSourceResolutionV1 | null;
}): CmoWeeklyGoalPlanSourceContractsV1 {
  return {
    goal_contract: input.goal?.contract === "cmo.goal.v1" ? "cmo.goal.v1" : null,
    baseline_target_contract: input.baselineTarget?.contract === "cmo.goal_baseline_target.v1" ? "cmo.goal_baseline_target.v1" : null,
    metric_source_resolution_contract: input.metricSourceResolution?.contract === "lens.metric_source_resolution.v1"
      ? "lens.metric_source_resolution.v1"
      : null,
  };
}

export function assembleCmoWeeklyGoalPlan(input: AssembleCmoWeeklyGoalPlanInputV1 | null | undefined = {}): CmoWeeklyGoalPlanV1 {
  const safeInput = isRecord(input) ? input : {};
  const goal = isCmoGoal(safeInput.goal) ? safeInput.goal : null;
  const baselineTarget = isCmoGoalBaselineTarget(safeInput.baselineTarget) ? safeInput.baselineTarget : null;
  const metricSourceResolution = isLensMetricSourceResolution(safeInput.metricSourceResolution)
    ? safeInput.metricSourceResolution
    : isLensMetricSourceResolution(goal?.metric_source_resolution)
      ? goal.metric_source_resolution
      : null;
  const status = cmoWeeklyGoalPlanStatusFromBaselineTarget({
    goal,
    baselineTarget,
    metricSourceResolution,
  });
  const goalKind = normalizeGoalKind(goal?.normalized_goal_kind ?? baselineTarget?.metric.kind ?? metricSourceResolution?.goal_kind);
  const resolvedMetricLabel = metricLabel(goal, baselineTarget, metricSourceResolution);
  const startDate = startDateForPlan({
    startDate: safeInput.startDate,
    now: safeInput.now,
    goal,
    baselineTarget,
  });
  const missingCapabilities = missingCapabilitiesForStatus({
    status,
    baselineTarget,
    sourceResolution: metricSourceResolution,
  });
  const dependencies = dependenciesForStatus(status, baselineTarget);
  const utmIntent = createCmoWeeklyGoalUtmIntent({
    goal,
    baselineTarget,
    metricSourceResolution,
    startDate,
  });
  const context: CmoWeeklyGoalPlanContextV1 = {
    goal,
    baselineTarget,
    metricSourceResolution,
    status,
    goalKind,
    metricLabel: resolvedMetricLabel,
    startDate,
    missingCapabilities,
    dependencies,
    utmIntent,
  };
  const days = createCmoWeeklyGoalPlanDays(context);

  return {
    contract: CMO_WEEKLY_GOAL_PLAN_CONTRACT,
    goal_id: goal?.goal_id ?? baselineTarget?.goal_id ?? null,
    workspace_id: goal?.workspace_id ?? baselineTarget?.workspace_id ?? null,
    app_id: goal?.app_id ?? baselineTarget?.app_id ?? null,
    session_id: goal?.session_id ?? baselineTarget?.session_id ?? null,
    source_contracts: sourceContracts({
      goal,
      baselineTarget,
      metricSourceResolution,
    }),
    status,
    plan_summary: createCmoWeeklyGoalPlanSummary(context),
    days,
    draft_assembly: createDraftAssembly({
      days,
      utmIntent,
      status,
    }),
    approval: {
      approval_required: true,
      approval_type: "plan",
      approval_prompt: createCmoWeeklyGoalPlanApprovalPrompt({
        status,
        metricLabel: resolvedMetricLabel,
      }),
      execution_approval_required_separately: true,
    },
    guardrails: {
      no_execution: true,
      no_publish: true,
      no_schedule: true,
      approval_required_before_execution: true,
      estimated_metrics_must_be_labeled: true,
    },
  };
}
