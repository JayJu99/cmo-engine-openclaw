import type {
  CMOChatMessage,
  CmoActivityStepDisplay,
  CmoEvidenceSourceDisplay,
  HermesCmoChatMetadata,
} from "@/lib/cmo/app-workspace-types";

type EvidenceKind = "ga4_ad_hoc" | "metric_definition" | "vault_daily_report" | "cached_snapshot";

const SENSITIVE_TEXT_PATTERN =
  /\b(access_token|refresh_token|id_token|encrypted_refresh_token|CMO_LENS_INTERNAL_API_KEY|Authorization|Bearer|raw_ga4_response|raw connector payload|stack trace)\b|(?:^|\s)at\s+[A-Za-z0-9_$.[\]]+\s+\(|[A-Za-z]:[\\/](?:Users|Windows|Holdstation|tmp|var|etc)[\\/]/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maxChars = 160): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return null;
  }

  const text = String(value).replace(/\s+/g, " ").trim();

  if (!text || SENSITIVE_TEXT_PATTERN.test(text)) {
    return null;
  }

  return text.length > maxChars ? `${text.slice(0, maxChars - 3).trimEnd()}...` : text;
}

function safeRelativePath(value: unknown): string | null {
  const text = safeText(value, 220);

  if (!text || /^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("/") || text.includes("..")) {
    return null;
  }

  return text;
}

function safeList(value: unknown, maxItems = 6): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => safeText(item, 80))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

function safeObjectText(value: unknown, maxChars = 4000): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return safeText(value, maxChars);
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => safeObjectText(item, Math.min(maxChars, 600)))
      .filter((item): item is string => Boolean(item))
      .join(" ");

    return safeText(text, maxChars);
  }

  if (isRecord(value)) {
    const text = Object.entries(value)
      .map(([key, item]) => `${key} ${safeObjectText(item, Math.min(maxChars, 600)) ?? ""}`)
      .join(" ");

    return safeText(text, maxChars);
  }

  return null;
}

function firstSafe(record: Record<string, unknown>, keys: string[], maxChars?: number): string | null {
  for (const key of keys) {
    const value = safeText(record[key], maxChars);

    if (value) {
      return value;
    }
  }

  return null;
}

function firstSafeList(record: Record<string, unknown>, keys: string[], maxItems = 6): string[] {
  for (const key of keys) {
    const value = safeList(record[key], maxItems);

    if (value.length > 0) {
      return value;
    }
  }

  return [];
}

function percentValue(value: unknown): string | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  const ratio = Math.abs(numberValue) <= 1 ? numberValue * 100 : numberValue;

  return `${ratio.toFixed(2)}%`;
}

function compactNumber(value: unknown): string | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;

  if (!Number.isFinite(numberValue)) {
    return safeText(value);
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: numberValue >= 100 ? 0 : 2 }).format(numberValue);
}

function traceSummary(message: CMOChatMessage): Record<string, unknown> {
  const metadata = message.hermesCmoMetadata;
  const trace = metadata?.toolTraceSummary ?? metadata?.tool_trace_summary;

  return isRecord(trace) ? trace : {};
}

function metadata(message: CMOChatMessage): HermesCmoChatMetadata | undefined {
  return message.hermesCmoMetadata;
}

function toolNames(message: CMOChatMessage): string[] {
  const data = metadata(message);
  const trace = traceSummary(message);

  return [
    ...(data?.toolsUsed ?? []),
    ...(data?.tools_used ?? []),
    ...(message.cmoRunToolsUsed ?? []),
    ...safeList(trace.tools_used, 12),
    ...safeList(trace.toolsUsed, 12),
    ...safeList(trace.tools, 12),
    firstSafe(trace, ["tool", "tool_name", "toolName"], 80),
  ]
    .map((tool) => safeText(tool, 80))
    .filter((tool): tool is string => Boolean(tool));
}

function hasTool(message: CMOChatMessage, pattern: RegExp): boolean {
  return toolNames(message).some((tool) => pattern.test(tool));
}

function sameText(left: string | null, right: string): boolean {
  return Boolean(left && left.toLowerCase() === right.toLowerCase());
}

function evidenceText(message: CMOChatMessage, trace: Record<string, unknown>): string {
  return [
    safeText(message.content, 4000),
    safeObjectText(trace, 4000),
  ]
    .filter((item): item is string => Boolean(item))
    .join(" ");
}

function evidenceHints(message: CMOChatMessage, trace: Record<string, unknown>): Set<EvidenceKind> {
  const text = evidenceText(message, trace);
  const hints = new Set<EvidenceKind>();

  if (/Lens\s*\/\s*GA4\s+ad-?hoc\s+query/i.test(text)) {
    hints.add("ga4_ad_hoc");
  }

  if (/Lens\s*\/\s*Product\s+metric-definition\s+snapshot/i.test(text)) {
    hints.add("metric_definition");
  }

  if (/Vault\s*\/\s*Lens\s+Daily\s+Report/i.test(text)) {
    hints.add("vault_daily_report");
  }

  if (/Lens\s*(?:\/\s*GA4\s*)?cached\s+snapshot/i.test(text)) {
    hints.add("cached_snapshot");
  }

  return hints;
}

function traceLooksLike(trace: Record<string, unknown>, kind: EvidenceKind): boolean {
  const sourceLabel = firstSafe(trace, ["source_label", "sourceLabel"], 120);

  if (sourceLabel) {
    if (kind === "ga4_ad_hoc") {
      return sameText(sourceLabel, "Lens / GA4 ad-hoc query");
    }

    if (kind === "metric_definition") {
      return sameText(sourceLabel, "Lens / Product metric-definition snapshot");
    }

    if (kind === "vault_daily_report") {
      return sameText(sourceLabel, "Vault / Lens Daily Report");
    }

    if (kind === "cached_snapshot") {
      return sameText(sourceLabel, "Lens / GA4 cached snapshot") || sameText(sourceLabel, "Lens cached snapshot");
    }
  }

  const joined = Object.entries(trace)
    .map(([key, value]) => `${key}:${Array.isArray(value) ? value.join(",") : String(value)}`)
    .join(" ");

  if (kind === "ga4_ad_hoc") {
    return /ga4|ad.?hoc|query_result|sessionDefaultChannelGroup|eventName/i.test(joined);
  }

  if (kind === "metric_definition") {
    return /metric.?definition|activation|retention|activated_users|activation_rate|not_matured/i.test(joined);
  }

  if (kind === "vault_daily_report") {
    return /daily.?report|lens.?daily|report_date|truth_status|review_status/i.test(joined);
  }

  return /cached.?snapshot|comparison|snapshot|lens_readout/i.test(joined);
}

function rangeValue(trace: Record<string, unknown>): string | null {
  const key = firstSafe(trace, ["range_key", "rangeKey", "current_range", "currentRange"]);
  const start = firstSafe(trace, ["date_start", "dateStart"]);
  const end = firstSafe(trace, ["date_end", "dateEnd"]);

  if (key && start && end) {
    return `${key} · ${start} -> ${end}`;
  }

  if (start && end) {
    return `${start} -> ${end}`;
  }

  return key;
}

function row(label: string, value: string | null | undefined): CmoEvidenceSourceDisplay["rows"][number] | null {
  return value ? { label, value } : null;
}

function compactRows(rows: Array<CmoEvidenceSourceDisplay["rows"][number] | null>): CmoEvidenceSourceDisplay["rows"] {
  return rows.filter((item): item is CmoEvidenceSourceDisplay["rows"][number] => Boolean(item)).slice(0, 8);
}

function rowsOrFallback(
  rows: Array<CmoEvidenceSourceDisplay["rows"][number] | null>,
  sourceLabel: CmoEvidenceSourceDisplay["sourceLabel"],
): CmoEvidenceSourceDisplay["rows"] {
  const compacted = compactRows(rows);

  return compacted.length ? compacted : [{ label: "Source", value: sourceLabel }];
}

function warningRows(trace: Record<string, unknown>): string[] {
  return [
    ...safeList(trace.warnings, 3),
    firstSafe(trace, ["warning", "caveat"], 180),
  ].filter((item): item is string => Boolean(item)).slice(0, 3);
}

function ga4AdHocEvidence(trace: Record<string, unknown>, forced = false): CmoEvidenceSourceDisplay | null {
  if (!forced && !traceLooksLike(trace, "ga4_ad_hoc")) {
    return null;
  }

  const metrics = firstSafeList(trace, ["metrics", "metric_names", "metricNames"]);
  const dimensions = firstSafeList(trace, ["dimensions", "dimension_names", "dimensionNames"]);
  const topDimension = firstSafe(trace, ["top_dimension", "topDimension", "dimension"]);
  const rowsCount = compactNumber(trace.rows ?? trace.row_count ?? trace.rowCount);
  const cache = firstSafe(trace, ["cache", "cache_status", "cacheStatus"]);

  return {
    key: "ga4-ad-hoc-query",
    sourceLabel: "Lens / GA4 ad-hoc query",
    rows: rowsOrFallback([
      row("Range", rangeValue(trace)),
      row("Metrics", metrics.join(", ")),
      row("Dimensions", dimensions.join(", ")),
      row("Top dimension", topDimension),
      row("Rows", rowsCount),
      row("Cache", cache),
    ], "Lens / GA4 ad-hoc query"),
    warnings: warningRows(trace),
    collapsedByDefault: true,
  };
}

function metricDefinitionEvidence(trace: Record<string, unknown>, forced = false): CmoEvidenceSourceDisplay | null {
  if (!forced && !traceLooksLike(trace, "metric_definition")) {
    return null;
  }

  const activatedUsers = compactNumber(trace.activated_users ?? trace.activatedUsers);
  const activationRate = percentValue(trace.activation_rate ?? trace.activationRate);
  const activationEvents = firstSafeList(trace, ["activation_events", "activationEvents", "events"]);
  const retentionStatus = firstSafe(trace, ["retention_status", "retentionStatus"]);

  return {
    key: "metric-definition-snapshot",
    sourceLabel: "Lens / Product metric-definition snapshot",
    rows: rowsOrFallback([
      row("Range", rangeValue(trace)),
      row("Activation status", firstSafe(trace, ["activation_status", "activationStatus", "status"])),
      row("Activation", activatedUsers && activationRate ? `${activatedUsers} users · ${activationRate}` : activationRate ?? activatedUsers),
      row("Definition", activationEvents.join(", ")),
      row("Denominator", firstSafe(trace, ["denominator", "activation_denominator", "activationDenominator"])),
      row("Retention", retentionStatus ?? firstSafe(trace, ["retention_reason", "retentionReason"])),
    ], "Lens / Product metric-definition snapshot"),
    warnings: warningRows(trace),
    caveats: ["Activation is not conversion unless explicitly defined."],
    collapsedByDefault: true,
  };
}

function vaultDailyReportEvidence(trace: Record<string, unknown>, forced = false): CmoEvidenceSourceDisplay | null {
  if (!forced && !traceLooksLike(trace, "vault_daily_report")) {
    return null;
  }

  const sections = firstSafeList(trace, ["sections", "available_sections", "availableSections"], 8);

  return {
    key: "vault-lens-daily-report",
    sourceLabel: "Vault / Lens Daily Report",
    rows: rowsOrFallback([
      row("Report date", firstSafe(trace, ["report_date", "reportDate", "date"])),
      row("Workspace", firstSafe(trace, ["workspace", "workspace_id", "workspaceId"])),
      row("Path", safeRelativePath(trace.path ?? trace.vault_path ?? trace.report_path)),
      row("Sections", sections.join(", ")),
      row("Status", firstSafe(trace, ["truth_status", "truthStatus", "review_status", "reviewStatus", "status"])),
    ], "Vault / Lens Daily Report"),
    warnings: warningRows(trace),
    collapsedByDefault: true,
  };
}

function cachedSnapshotEvidence(message: CMOChatMessage, trace: Record<string, unknown>, forced = false): CmoEvidenceSourceDisplay | null {
  const data = metadata(message);
  const hasLensReadout = data?.lensReadoutAttached === true || data?.lens_readout_attached === true;

  if (!forced && !hasLensReadout && !traceLooksLike(trace, "cached_snapshot")) {
    return null;
  }

  return {
    key: "lens-ga4-cached-snapshot",
    sourceLabel: "Lens / GA4 cached snapshot",
    rows: rowsOrFallback([
      row("Current range", firstSafe(trace, ["current_range", "currentRange"]) ?? data?.lensReadoutRangeKey ?? data?.lens_readout_range_key ?? null),
      row("Comparison range", firstSafe(trace, ["comparison_range", "comparisonRange"])),
      row("Status", firstSafe(trace, ["status"]) ?? data?.lensReadoutStatus ?? data?.lens_readout_status ?? null),
      row("Data", data?.lensReadoutDataStatus ?? data?.lens_readout_data_status ?? null),
      row("Metric", firstSafe(trace, ["metric", "metric_name", "metricName"])),
      row("Delta", firstSafe(trace, ["delta", "change", "comparison_delta"])),
    ], "Lens / GA4 cached snapshot"),
    warnings: [
      ...warningRows(trace),
      safeText(data?.lensReadoutContextWarning ?? data?.lens_readout_context_warning, 180),
    ].filter((item): item is string => Boolean(item)).slice(0, 3),
    collapsedByDefault: true,
  };
}

export function buildCmoEvidenceSources(message: CMOChatMessage): CmoEvidenceSourceDisplay[] {
  if (message.role !== "assistant") {
    return [];
  }

  const trace = traceSummary(message);
  const hints = evidenceHints(message, trace);
  const sources = [
    metricDefinitionEvidence(trace, hints.has("metric_definition")),
    ga4AdHocEvidence(trace, hints.has("ga4_ad_hoc")),
    vaultDailyReportEvidence(trace, hints.has("vault_daily_report")),
    cachedSnapshotEvidence(message, trace, hints.has("cached_snapshot")),
  ].filter((item): item is CmoEvidenceSourceDisplay => Boolean(item));
  const seen = new Set<string>();

  return sources.filter((source) => {
    if (source.rows.length === 0 || seen.has(source.key)) {
      return false;
    }

    seen.add(source.key);
    return true;
  });
}

function step(key: string, label: string, detail?: string): CmoActivityStepDisplay {
  return {
    key,
    label,
    status: "completed",
    ...(detail ? { detail } : {}),
  };
}

export function buildCmoActivitySteps(message: CMOChatMessage, running = false): CmoActivityStepDisplay[] {
  if (message.role !== "assistant") {
    return [];
  }

  if (running) {
    return [{ key: "cmo-running", label: "CMO analyzing", status: "running" }];
  }

  const evidence = buildCmoEvidenceSources(message);
  const usesLens = hasTool(message, /cmo_call_lens|lens/i) ||
    evidence.some((source) => source.sourceLabel.startsWith("Lens /"));
  const usesVaultReport = evidence.some((source) => source.sourceLabel === "Vault / Lens Daily Report");
  const steps = [step("cmo", "CMO")];

  if (usesLens) {
    steps.push(step("lens", "Lens"));
  }

  if (evidence.some((source) => source.sourceLabel === "Lens / GA4 ad-hoc query")) {
    steps.push(step("ga4-query", "GA4 query"));
  }

  if (evidence.some((source) => source.sourceLabel === "Lens / Product metric-definition snapshot")) {
    steps.push(step("metric-snapshot", "Metric snapshot"));
  }

  if (evidence.some((source) => source.sourceLabel === "Lens / GA4 cached snapshot")) {
    steps.push(step("cached-snapshot", "Cached snapshot"));
  }

  if (usesVaultReport) {
    steps.push(step("vault-report", "Vault report"));
  }

  steps.push(step("cmo-answered", "CMO answered"));

  if (steps.length === 2 && (message.cmoRunStatus || message.hermesCmoMetadata?.activityEventsCount)) {
    return [step("cmo-completed", "CMO completed")];
  }

  return steps;
}
