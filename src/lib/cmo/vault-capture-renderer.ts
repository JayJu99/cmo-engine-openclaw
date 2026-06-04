import { buildCaptureTarget } from "./vault-capture-paths";
import { redactSensitiveText, redactSensitiveTextWithMetadata } from "./vault-capture-redaction";
import type { CMOVaultCaptureEvent, CMOVaultCaptureResult, CMOVaultReviewStatus } from "./vault-capture-types";

const VALID_AGENTS = new Set(["CMO", "Echo", "Surf"]);

function defaultReviewStatus(event: CMOVaultCaptureEvent): CMOVaultReviewStatus {
  if (event.reviewStatus) return event.reviewStatus;
  if (event.type === "cmo_decision" || event.type === "memory_candidate") return "review_candidate";
  return "raw";
}

function yamlScalar(value: unknown): string {
  if (value === undefined || value === null) return '""';
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}

function yamlList(values: string[] = []): string {
  if (!values.length) return " []";
  return values.map((value) => `\n  - ${JSON.stringify(value)}`).join("");
}

function warningFor(event: CMOVaultCaptureEvent): string[] {
  const warnings = [...(event.warnings ?? [])];
  if (event.sourceClass === "social_signal") warnings.push("X/social signal is not verified fact.");
  if (event.sourceClass === "weak_trend_signal") warnings.push("Last30Days/trend signal is weak signal, not verified fact.");
  if (event.sourceClass === "execution_artifact") warnings.push("Generated output is not strategy/research/published content unless separately reviewed.");
  if (event.sourceClass === "cmo_interpretation") warnings.push("CMO decision is interpretation until reviewed/promoted.");
  if (event.sourceClass === "failure") warnings.push("Failure/blocker record is operational evidence, not a successful result.");
  if (event.sourceClass === "composite") warnings.push("Composite capture must preserve branch source classes.");
  return Array.from(new Set(warnings));
}

function validateEvent(event: CMOVaultCaptureEvent): string | undefined {
  if (!VALID_AGENTS.has(event.sourceAgent)) return `Invalid source_agent: ${event.sourceAgent}. Only CMO, Echo, and Surf are agents.`;
  if (event.type === "surf_x_signal" && !(event.sourceAgent === "Surf" && event.mode === "x_search" && ["surf_x", "x_search"].includes(event.skill ?? "") && event.sourceClass === "social_signal")) {
    return 'Surf X captures must use source_agent "Surf", mode "x_search", skill "surf_x" or "x_search", source_class "social_signal".';
  }
  if (event.type === "last30days_trend" && !(event.sourceAgent === "Surf" && event.mode === "last30days" && ["trend", "last30days"].includes(event.skill ?? "") && event.sourceClass === "weak_trend_signal")) {
    return 'Last30Days captures must use source_agent "Surf", mode "last30days", skill "trend" or "last30days", source_class "weak_trend_signal".';
  }
  if (event.type === "pulse_pack" && !(event.sourceAgent === "Surf" && event.mode === "pulse" && event.skill === "pulse" && event.sourceClass === "composite")) {
    return 'Pulse captures must use source_agent "Surf", mode "pulse", skill "pulse", source_class "composite".';
  }
  return undefined;
}


function renderKeyFindings(event: CMOVaultCaptureEvent): string {
  const findings = event.keyFindings ?? [];
  if (!findings.length) return "- See summary.";
  if (event.type === "echo_output") {
    return findings.map((item) => redactSensitiveText(item)
      .replace(/^\s*#{1,2}\s+Agent Execution\s*\n?/im, "")
      .replace(/^\s*##\s+Echo Output\s*$/gim, "### Echo Output")
      .trim()).filter(Boolean).join("\n\n") || "- See summary.";
  }
  return findings.map((item) => `- ${redactSensitiveText(item).replace(/^\s*#{1,6}\s+/gm, "").trim()}`).join("\n");
}

function renderLinks(event: CMOVaultCaptureEvent): string[] {
  const urls = [...(event.sourceUrls ?? []), ...(event.evidenceLinks ?? []).map((link) => link.url)];
  return Array.from(new Set(urls)).map((url) => `- [source](${url})`);
}

export function renderCaptureMarkdown(event: CMOVaultCaptureEvent): string {
  const reviewStatus = defaultReviewStatus(event);
  const title = event.title || event.topic || event.summary.slice(0, 80) || event.type;
  const sourceUrls = Array.from(new Set([...(event.sourceUrls ?? []), ...(event.evidenceLinks ?? []).map((link) => link.url)]));
  const related = event.related ?? [];
  const tags = Array.from(new Set(["cmo-engine", ...(event.tags ?? [])]));
  const warnings = warningFor(event);
  const payloadRedaction = redactSensitiveTextWithMetadata(event.payloadSummary || event.rawExcerpt || "");
  const summaryRedaction = redactSensitiveTextWithMetadata(event.summary);
  const findingRedactions = (event.keyFindings ?? []).map((item) => redactSensitiveTextWithMetadata(item));
  const redactionTypes = Array.from(new Set([...(event.redactionTypes ?? []), ...payloadRedaction.types, ...summaryRedaction.types, ...findingRedactions.flatMap((item) => item.types)])).sort();
  const redactionApplied = event.redactionApplied === true || redactionTypes.length > 0;
  const payload = payloadRedaction.text;

  return `---\ntitle: ${yamlScalar(title)}\ntype: ${yamlScalar(event.type)}\nvault: cmo-engine\nauth_mode: ${yamlScalar(event.authMode ?? "legacy")}\nuser_id: ${yamlScalar(event.userId ?? "")}\nuser_email: ${yamlScalar(event.userEmail ?? "")}\nuser_slug: ${yamlScalar(event.userSlug ?? "")}\nuser_display_name: ${yamlScalar(event.userDisplayName ?? "")}\nemail: ${yamlScalar(event.email ?? event.userEmail ?? "")}\ncreated_by_user_id: ${yamlScalar(event.createdByUserId ?? event.userId ?? "")}\ncreated_by_email: ${yamlScalar(event.createdByEmail ?? event.userEmail ?? "")}\nsource_user_id: ${yamlScalar(event.sourceUserId ?? "")}\nsource_user_email: ${yamlScalar(event.sourceUserEmail ?? "")}\nsource_user_message_id: ${yamlScalar(event.sourceUserMessageId ?? "")}\nworkspace_id: ${yamlScalar(event.workspaceId ?? "")}\nworkspace_group: ${yamlScalar(event.workspaceGroup ?? "")}\nproject: ${yamlScalar(event.project ?? "")}\nsession_id: ${yamlScalar(event.sessionId ?? "")}\nmessage_id: ${yamlScalar(event.messageId ?? event.requestId ?? "")}\nsource_agent: ${yamlScalar(event.sourceAgent)}\nmode: ${yamlScalar(event.mode ?? "")}\nskill: ${yamlScalar(event.skill ?? "")}\nsource_class: ${yamlScalar(event.sourceClass)}\nreview_status: ${yamlScalar(reviewStatus)}\nvisibility: ${yamlScalar(event.visibility ?? "private")}\ncapture_origin: ${yamlScalar(event.captureOrigin ?? (event.captureMode === "auto_raw" ? "auto" : "manual"))}\ngbrain_status: ${yamlScalar(event.gbrainStatus ?? "pending")}\nredaction_applied: ${redactionApplied ? "true" : "false"}\nredaction_types:${yamlList(redactionTypes)}\ncreated_at: ${yamlScalar(event.createdAt)}\ndate_range:\n  start: ${yamlScalar(event.dateRange?.start ?? "")}\n  end: ${yamlScalar(event.dateRange?.end ?? "")}\nsource_urls:${yamlList(sourceUrls)}\nrelated:${yamlList(related)}\ntags:${yamlList(tags)}\n---\n\n# ${title}\n\n## Summary\n${summaryRedaction.text}\n\n## Source / Provenance\n- Source agent: ${event.sourceAgent}\n- Mode: ${event.mode ?? ""}\n- Skill: ${event.skill ?? ""}\n- Session ID: ${event.sessionId ?? ""}\n- Request ID: ${event.requestId ?? ""}\n- Workspace: ${event.workspaceId ?? ""}\n- Auth mode: ${event.authMode ?? "legacy"}\n- User ID: ${event.userId ?? ""}\n- User slug: ${event.userSlug ?? ""}\n\n## Evidence / Links\n${renderLinks(event).join("\n") || "- None supplied."}\n\n## Related Wikilinks\n${related.map((item) => `- ${item.startsWith("[[") ? item : `[[${item}]]`}`).join("\n") || "- None supplied."}\n\n## Key Findings / Outputs\n${renderKeyFindings(event)}\n\n## Warnings\n${warnings.map((item) => `- ${item}`).join("\n") || "- None."}\n\n## Next Checks\n${(event.nextChecks ?? []).map((item) => `- ${redactSensitiveText(item)}`).join("\n") || "- None supplied."}\n\n## Payload Summary\n${payload || "No payload summary supplied."}\n`;
}

export function buildCapturePreview(event: CMOVaultCaptureEvent): CMOVaultCaptureResult {
  const error = validateEvent(event);
  if (error) return { ok: false, mode: "dry_run", savedToVault: false, warnings: [], error };
  const target = buildCaptureTarget(event);
  const markdown = renderCaptureMarkdown(event);
  return { ok: true, mode: "dry_run", target, markdown, savedToVault: false, warnings: warningFor(event) };
}
