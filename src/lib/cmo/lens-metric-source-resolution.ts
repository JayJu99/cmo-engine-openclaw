export const LENS_METRIC_SOURCE_RESOLUTION_CONTRACT = "lens.metric_source_resolution.v1" as const;

export const LENS_METRIC_SOURCE_TYPES_V1 = [
  "ga4_utm",
  "meta_page_insights",
  "x_post_insights",
  "x_api",
  "manual_input",
  "estimated",
] as const;

export type LensMetricSourceResolutionContractV1 = typeof LENS_METRIC_SOURCE_RESOLUTION_CONTRACT;
export type LensMetricSourceTypeV1 = (typeof LENS_METRIC_SOURCE_TYPES_V1)[number];
export type LensMetricSourceStatusV1 = "ready" | "partial" | "missing" | "permission_failed" | "not_configured" | "unavailable";
export type LensMetricSourceRoleV1 = "primary" | "enrichment" | "fallback";
export type LensMetricSourceConfidenceV1 = "high" | "medium" | "low" | "estimated";
export type LensMetricBaselineStatusV1 = "available" | "partial" | "missing" | "estimated";
export type LensMetricMissingRequirementSeverityV1 = "blocking" | "non_blocking";
export type LensMetricGoalKindV1 =
  | "traffic"
  | "facebook_engagement"
  | "x_engagement"
  | "platform_engagement"
  | "conversion"
  | "activation"
  | "unknown";

export interface MetricSourceOptionV1 {
  source_type: LensMetricSourceTypeV1;
  source_id: string;
  label: string;
  provider: "google_analytics" | "meta" | "x" | "manual" | "lens";
  status: LensMetricSourceStatusV1;
  role: LensMetricSourceRoleV1;
  supported_metrics: string[];
  available_metrics: string[];
  missing_metrics: string[];
  reason?: string;
}

export interface LensMetricSourceCapabilityV1 {
  source_type: LensMetricSourceTypeV1;
  source_id?: string | null;
  label?: string | null;
  provider?: MetricSourceOptionV1["provider"] | null;
  status?: LensMetricSourceStatusV1 | "connected" | "synced" | "verified" | "failed" | "skipped" | "placeholder" | null;
  available_metrics?: string[] | null;
  missing_metrics?: string[] | null;
  reason?: string | null;
}

export interface LensExistingChannelMetricsAvailabilityV1 {
  channel: "facebook" | "x" | string;
  source_type?: LensMetricSourceTypeV1 | null;
  source_id?: string | null;
  status?: LensMetricSourceCapabilityV1["status"];
  available_metrics?: string[] | null;
  missing_metrics?: string[] | null;
  permission_failed?: boolean | null;
  reason?: string | null;
}

export interface LensMetricSourceCapabilitiesInputV1 {
  workspace?: LensMetricSourceCapabilityV1[];
  app?: LensMetricSourceCapabilityV1[];
  channel?: LensMetricSourceCapabilityV1[];
}

export interface ResolveLensMetricSourceInputV1 {
  raw_user_goal_message: string;
  normalized_goal_kind?: LensMetricGoalKindV1 | string | null;
  capabilities?: LensMetricSourceCapabilitiesInputV1;
  existing_channel_metrics_availability?: LensExistingChannelMetricsAvailabilityV1[];
}

export interface LensMetricSourceMissingRequirementV1 {
  key: string;
  source_type: LensMetricSourceTypeV1;
  severity: LensMetricMissingRequirementSeverityV1;
  action: string;
  safe_user_message: string;
}

export interface LensMetricSourceResolutionV1 {
  contract: LensMetricSourceResolutionContractV1;
  resolved_metric: string;
  goal_kind: LensMetricGoalKindV1;
  primary_source: MetricSourceOptionV1 | null;
  enrichment_sources: MetricSourceOptionV1[];
  fallback_sources: MetricSourceOptionV1[];
  confidence: LensMetricSourceConfidenceV1;
  baseline_status: LensMetricBaselineStatusV1;
  missing_requirements: LensMetricSourceMissingRequirementV1[];
}

const GA4_UTM_METRICS = [
  "social_referral_sessions",
  "landing_page_sessions",
  "engaged_sessions",
  "conversions",
  "utm_campaign_sessions",
  "utm_source_sessions",
] as const;

const META_PAGE_INSIGHTS_METRICS = [
  "facebook_views",
  "facebook_unique_views",
  "facebook_engagement",
  "facebook_post_count",
  "facebook_video_views",
  "facebook_follower_count",
  "facebook_follower_growth",
  "facebook_link_clicks",
  "facebook_ctr",
  "impressions",
  "likes",
  "comments",
  "shares",
] as const;

const X_INSIGHTS_METRICS = [
  "impressions",
  "likes",
  "reposts",
  "replies",
  "quotes",
  "bookmarks",
  "url_link_clicks",
  "profile_clicks",
  "engagements",
  "video_views",
] as const;

const FALLBACK_METRICS = [
  "user_supplied_metric",
  "explicit_estimate",
  "measurement_note",
] as const;

const SOURCE_RANK: Record<LensMetricSourceStatusV1, number> = {
  ready: 5,
  partial: 4,
  permission_failed: 3,
  missing: 2,
  not_configured: 1,
  unavailable: 0,
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function stringArray(value: string[] | null | undefined): string[] {
  return Array.isArray(value)
    ? uniqueStrings(value.filter((item): item is string => typeof item === "string"))
    : [];
}

function providerForSource(sourceType: LensMetricSourceTypeV1): MetricSourceOptionV1["provider"] {
  if (sourceType === "ga4_utm") {
    return "google_analytics";
  }

  if (sourceType === "meta_page_insights") {
    return "meta";
  }

  if (sourceType === "x_post_insights" || sourceType === "x_api") {
    return "x";
  }

  if (sourceType === "manual_input") {
    return "manual";
  }

  return "lens";
}

function labelForSource(sourceType: LensMetricSourceTypeV1): string {
  if (sourceType === "ga4_utm") {
    return "GA4 and UTM";
  }

  if (sourceType === "meta_page_insights") {
    return "Meta Page Insights";
  }

  if (sourceType === "x_post_insights") {
    return "X Post Insights";
  }

  if (sourceType === "x_api") {
    return "X API";
  }

  if (sourceType === "manual_input") {
    return "Manual Input";
  }

  return "Estimated";
}

function supportedMetricsForSource(sourceType: LensMetricSourceTypeV1): string[] {
  if (sourceType === "ga4_utm") {
    return [...GA4_UTM_METRICS];
  }

  if (sourceType === "meta_page_insights") {
    return [...META_PAGE_INSIGHTS_METRICS];
  }

  if (sourceType === "x_post_insights" || sourceType === "x_api") {
    return [...X_INSIGHTS_METRICS];
  }

  return [...FALLBACK_METRICS];
}

function roleForSource(sourceType: LensMetricSourceTypeV1): LensMetricSourceRoleV1 {
  return sourceType === "manual_input" || sourceType === "estimated" ? "fallback" : "enrichment";
}

function normalizeStatus(value: LensMetricSourceCapabilityV1["status"], fallback: LensMetricSourceStatusV1): LensMetricSourceStatusV1 {
  if (value === "ready" || value === "connected" || value === "synced" || value === "verified") {
    return "ready";
  }

  if (value === "partial") {
    return "partial";
  }

  if (value === "permission_failed" || value === "failed") {
    return "permission_failed";
  }

  if (value === "not_configured" || value === "skipped" || value === "placeholder") {
    return "not_configured";
  }

  if (value === "missing" || value === "unavailable") {
    return value;
  }

  return fallback;
}

function defaultSourceOption(sourceType: LensMetricSourceTypeV1, status: LensMetricSourceStatusV1 = "missing"): MetricSourceOptionV1 {
  return {
    source_type: sourceType,
    source_id: sourceType,
    label: labelForSource(sourceType),
    provider: providerForSource(sourceType),
    status,
    role: roleForSource(sourceType),
    supported_metrics: supportedMetricsForSource(sourceType),
    available_metrics: [],
    missing_metrics: supportedMetricsForSource(sourceType),
  };
}

function optionFromCapability(input: LensMetricSourceCapabilityV1): MetricSourceOptionV1 {
  const supported = supportedMetricsForSource(input.source_type);
  const availableMetrics = stringArray(input.available_metrics);
  const missingMetrics = stringArray(input.missing_metrics);
  const status = normalizeStatus(
    input.status,
    availableMetrics.length ? "partial" : input.source_type === "manual_input" || input.source_type === "estimated" ? "ready" : "missing",
  );

  return {
    source_type: input.source_type,
    source_id: input.source_id?.trim() || input.source_type,
    label: input.label?.trim() || labelForSource(input.source_type),
    provider: input.provider || providerForSource(input.source_type),
    status,
    role: roleForSource(input.source_type),
    supported_metrics: supported,
    available_metrics: availableMetrics,
    missing_metrics: missingMetrics.length
      ? missingMetrics
      : status === "ready" && availableMetrics.length
      ? supported.filter((metric) => !availableMetrics.includes(metric))
      : status === "ready"
      ? []
      : supported,
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
  };
}

function capabilityFromExistingChannel(input: LensExistingChannelMetricsAvailabilityV1): LensMetricSourceCapabilityV1 | null {
  const sourceType = input.source_type ||
    (input.channel === "facebook" ? "meta_page_insights" : input.channel === "x" ? "x_post_insights" : null);

  if (!sourceType) {
    return null;
  }

  return {
    source_type: sourceType,
    source_id: input.source_id || `${input.channel}_channel_metrics`,
    status: input.permission_failed ? "permission_failed" : input.status,
    available_metrics: input.available_metrics,
    missing_metrics: input.missing_metrics,
    reason: input.reason,
  };
}

function isUsableSource(source: MetricSourceOptionV1 | undefined): source is MetricSourceOptionV1 {
  return Boolean(source && (source.status === "ready" || source.status === "partial"));
}

function mergeSourceOptions(options: MetricSourceOptionV1[]): Map<LensMetricSourceTypeV1, MetricSourceOptionV1> {
  const merged = new Map<LensMetricSourceTypeV1, MetricSourceOptionV1>();

  for (const option of options) {
    const existing = merged.get(option.source_type);

    if (!existing) {
      merged.set(option.source_type, option);
      continue;
    }

    const status = SOURCE_RANK[option.status] > SOURCE_RANK[existing.status] ? option.status : existing.status;
    const availableMetrics = uniqueStrings([...existing.available_metrics, ...option.available_metrics]);
    const missingMetrics = uniqueStrings([...existing.missing_metrics, ...option.missing_metrics])
      .filter((metric) => !availableMetrics.includes(metric));

    merged.set(option.source_type, {
      ...existing,
      ...option,
      status,
      role: roleForSource(option.source_type),
      available_metrics: availableMetrics,
      missing_metrics: status === "ready" && !missingMetrics.length ? [] : missingMetrics,
      reason: option.reason || existing.reason,
    });
  }

  return merged;
}

function allSourceOptions(input: ResolveLensMetricSourceInputV1): Map<LensMetricSourceTypeV1, MetricSourceOptionV1> {
  const capabilityOptions = [
    ...(input.capabilities?.workspace ?? []),
    ...(input.capabilities?.app ?? []),
    ...(input.capabilities?.channel ?? []),
    ...(input.existing_channel_metrics_availability ?? []).map(capabilityFromExistingChannel).filter((item): item is LensMetricSourceCapabilityV1 => Boolean(item)),
  ].map(optionFromCapability);
  const fallbackOptions = [
    defaultSourceOption("manual_input", "ready"),
    defaultSourceOption("estimated", "ready"),
  ];
  const merged = mergeSourceOptions([
    ...LENS_METRIC_SOURCE_TYPES_V1.map((sourceType) => defaultSourceOption(sourceType)),
    ...capabilityOptions,
    ...fallbackOptions,
  ]);

  for (const sourceType of ["manual_input", "estimated"] as const) {
    const source = merged.get(sourceType);

    if (source) {
      merged.set(sourceType, {
        ...source,
        status: "ready",
        missing_metrics: [],
      });
    }
  }

  return merged;
}

function normalizeExplicitGoalKind(value: string | null | undefined): LensMetricGoalKindV1 {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (
    normalized === "traffic" ||
    normalized === "facebook_engagement" ||
    normalized === "x_engagement" ||
    normalized === "platform_engagement" ||
    normalized === "conversion" ||
    normalized === "activation" ||
    normalized === "unknown"
  ) {
    return normalized;
  }

  if (normalized === "twitter_engagement") {
    return "x_engagement";
  }

  return "unknown";
}

export function resolveLensMetricGoalKind(input: Pick<ResolveLensMetricSourceInputV1, "normalized_goal_kind">): LensMetricGoalKindV1 {
  return normalizeExplicitGoalKind(input.normalized_goal_kind);
}

function resolvedMetricForGoal(goalKind: LensMetricGoalKindV1): string {
  if (goalKind === "traffic") {
    return "website_traffic";
  }

  if (goalKind === "facebook_engagement") {
    return "facebook_engagement";
  }

  if (goalKind === "x_engagement") {
    return "x_engagement";
  }

  if (goalKind === "platform_engagement") {
    return "platform_engagement";
  }

  if (goalKind === "conversion") {
    return "conversions";
  }

  if (goalKind === "activation") {
    return "activation";
  }

  return "unknown_metric";
}

function requirementAction(sourceType: LensMetricSourceTypeV1): string {
  if (sourceType === "ga4_utm") {
    return "connect_or_verify_ga4_utm";
  }

  if (sourceType === "meta_page_insights") {
    return "connect_or_verify_meta_page_insights";
  }

  if (sourceType === "x_post_insights" || sourceType === "x_api") {
    return "connect_or_verify_x_insights";
  }

  if (sourceType === "manual_input") {
    return "provide_manual_input";
  }

  return "use_estimated_mode";
}

function requirementMessage(sourceType: LensMetricSourceTypeV1, severity: LensMetricMissingRequirementSeverityV1): string {
  if (sourceType === "ga4_utm") {
    return severity === "blocking"
      ? "Connect and verify GA4 with UTM coverage before Lens can claim a true website traffic baseline."
      : "GA4 and UTM coverage would improve traffic attribution.";
  }

  if (sourceType === "meta_page_insights") {
    return "Meta Page Insights can enrich platform performance but is not required for GA4 traffic truth.";
  }

  if (sourceType === "x_post_insights" || sourceType === "x_api") {
    return "X insights can enrich platform performance but is not required for GA4 traffic truth.";
  }

  if (sourceType === "manual_input") {
    return "Manual input can be used as a fallback when source truth is missing.";
  }

  return "Estimated mode can be used as a fallback with explicit uncertainty.";
}

function missingRequirement(source: MetricSourceOptionV1, severity: LensMetricMissingRequirementSeverityV1): LensMetricSourceMissingRequirementV1 {
  return {
    key: `${source.source_type}.${source.status}`,
    source_type: source.source_type,
    severity,
    action: requirementAction(source.source_type),
    safe_user_message: requirementMessage(source.source_type, severity),
  };
}

function missingGoalMetricRequirement(): LensMetricSourceMissingRequirementV1 {
  return {
    key: "goal_metric_resolution_missing",
    source_type: "estimated",
    severity: "blocking",
    action: "ask_cmo_to_resolve_goal_metric",
    safe_user_message: "CMO needs to resolve the goal metric before Lens can choose a primary measurement source.",
  };
}

function missingRequirementsForTraffic(input: {
  ga4: MetricSourceOptionV1;
  enrichments: MetricSourceOptionV1[];
}): LensMetricSourceMissingRequirementV1[] {
  const requirements: LensMetricSourceMissingRequirementV1[] = [];
  const ga4Ready = isUsableSource(input.ga4);

  if (!ga4Ready) {
    requirements.push(missingRequirement(input.ga4, "blocking"));
  }

  for (const source of input.enrichments) {
    if (!isUsableSource(source)) {
      requirements.push(missingRequirement(source, "non_blocking"));
    }
  }

  return requirements;
}

function missingRequirementsForPrimary(input: {
  primary: MetricSourceOptionV1 | null;
  candidates: MetricSourceOptionV1[];
}): LensMetricSourceMissingRequirementV1[] {
  if (input.primary) {
    return input.candidates
      .filter((source) => !isUsableSource(source))
      .map((source) => missingRequirement(source, "non_blocking"));
  }

  return input.candidates
    .filter((source) => !isUsableSource(source))
    .map((source, index) => missingRequirement(source, index === 0 ? "blocking" : "non_blocking"));
}

function trafficResolution(sources: Map<LensMetricSourceTypeV1, MetricSourceOptionV1>): Pick<
  LensMetricSourceResolutionV1,
  "primary_source" | "enrichment_sources" | "fallback_sources" | "confidence" | "baseline_status" | "missing_requirements"
> {
  const ga4 = sources.get("ga4_utm") ?? defaultSourceOption("ga4_utm");
  const enrichmentCandidates = [
    sources.get("meta_page_insights") ?? defaultSourceOption("meta_page_insights"),
    sources.get("x_post_insights") ?? defaultSourceOption("x_post_insights"),
    sources.get("x_api") ?? defaultSourceOption("x_api"),
  ];
  const primarySource = isUsableSource(ga4)
    ? {
      ...ga4,
      role: "primary" as const,
    }
    : null;
  const enrichmentSources = enrichmentCandidates
    .filter(isUsableSource)
    .map((source) => ({
      ...source,
      role: "enrichment" as const,
    }));

  return {
    primary_source: primarySource,
    enrichment_sources: enrichmentSources,
    fallback_sources: fallbackSources(sources),
    confidence: primarySource ? primarySource.status === "ready" ? "high" : "medium" : "low",
    baseline_status: primarySource ? primarySource.status === "ready" ? "available" : "partial" : "missing",
    missing_requirements: missingRequirementsForTraffic({
      ga4,
      enrichments: enrichmentCandidates,
    }),
  };
}

function firstUsable(sources: MetricSourceOptionV1[]): MetricSourceOptionV1 | null {
  return sources.find(isUsableSource) ?? null;
}

function engagementResolution(
  sources: Map<LensMetricSourceTypeV1, MetricSourceOptionV1>,
  preferredSources: LensMetricSourceTypeV1[],
): Pick<LensMetricSourceResolutionV1, "primary_source" | "enrichment_sources" | "fallback_sources" | "confidence" | "baseline_status" | "missing_requirements"> {
  const candidates = preferredSources.map((sourceType) => sources.get(sourceType) ?? defaultSourceOption(sourceType));
  const primary = firstUsable(candidates);
  const primarySource = primary
    ? {
      ...primary,
      role: "primary" as const,
    }
    : null;
  const enrichmentSources = candidates
    .filter((source) => source.source_type !== primarySource?.source_type && isUsableSource(source))
    .map((source) => ({
      ...source,
      role: "enrichment" as const,
    }));

  return {
    primary_source: primarySource,
    enrichment_sources: enrichmentSources,
    fallback_sources: fallbackSources(sources),
    confidence: primarySource ? primarySource.status === "ready" ? "high" : "medium" : "low",
    baseline_status: primarySource ? primarySource.status === "ready" ? "available" : "partial" : "missing",
    missing_requirements: missingRequirementsForPrimary({
      primary: primarySource,
      candidates,
    }),
  };
}

function ga4PrimaryResolution(sources: Map<LensMetricSourceTypeV1, MetricSourceOptionV1>): Pick<
  LensMetricSourceResolutionV1,
  "primary_source" | "enrichment_sources" | "fallback_sources" | "confidence" | "baseline_status" | "missing_requirements"
> {
  const ga4 = sources.get("ga4_utm") ?? defaultSourceOption("ga4_utm");
  const primarySource = isUsableSource(ga4)
    ? {
      ...ga4,
      role: "primary" as const,
    }
    : null;

  return {
    primary_source: primarySource,
    enrichment_sources: [],
    fallback_sources: fallbackSources(sources),
    confidence: primarySource ? primarySource.status === "ready" ? "high" : "medium" : "low",
    baseline_status: primarySource ? primarySource.status === "ready" ? "available" : "partial" : "missing",
    missing_requirements: primarySource ? [] : [missingRequirement(ga4, "blocking")],
  };
}

function fallbackSources(sources: Map<LensMetricSourceTypeV1, MetricSourceOptionV1>): MetricSourceOptionV1[] {
  return ["manual_input", "estimated"].map((sourceType) => ({
    ...(sources.get(sourceType as LensMetricSourceTypeV1) ?? defaultSourceOption(sourceType as LensMetricSourceTypeV1, "ready")),
    role: "fallback" as const,
    status: "ready" as const,
    missing_metrics: [],
  }));
}

function unknownGoalResolution(sources: Map<LensMetricSourceTypeV1, MetricSourceOptionV1>): Pick<
  LensMetricSourceResolutionV1,
  "primary_source" | "enrichment_sources" | "fallback_sources" | "confidence" | "baseline_status" | "missing_requirements"
> {
  return {
    primary_source: null,
    enrichment_sources: [],
    fallback_sources: fallbackSources(sources),
    confidence: "low",
    baseline_status: "missing",
    missing_requirements: [missingGoalMetricRequirement()],
  };
}

export function resolveLensMetricSourceResolution(input: ResolveLensMetricSourceInputV1): LensMetricSourceResolutionV1 {
  const sources = allSourceOptions(input);
  const goalKind = resolveLensMetricGoalKind({
    normalized_goal_kind: input.normalized_goal_kind,
  });
  const resolution = goalKind === "traffic"
    ? trafficResolution(sources)
    : goalKind === "facebook_engagement"
    ? engagementResolution(sources, ["meta_page_insights", "x_post_insights", "x_api"])
    : goalKind === "x_engagement"
    ? engagementResolution(sources, ["x_post_insights", "x_api", "meta_page_insights"])
    : goalKind === "platform_engagement"
    ? engagementResolution(sources, ["meta_page_insights", "x_post_insights", "x_api"])
    : goalKind === "unknown"
    ? unknownGoalResolution(sources)
    : ga4PrimaryResolution(sources);

  return {
    contract: LENS_METRIC_SOURCE_RESOLUTION_CONTRACT,
    resolved_metric: resolvedMetricForGoal(goalKind),
    goal_kind: goalKind,
    ...resolution,
  };
}
