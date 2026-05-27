import type { GBrainExtractionResult, GBrainMemoryCandidate, GBrainPendingCapture } from "./gbrain-types";

const ENTITY_NAMES = ["Holdstation Mini App", "Holdstation Wallet", "World App", "Worldchain", "MiniKit", "AION", "Winance", "Feeback", "TickX", "Hold Pay", "Morpho", "Dune"];

function uniq(values: string[]): string[] { return Array.from(new Set(values.filter(Boolean))); }
function textOf(capture: GBrainPendingCapture): string { return `${capture.title}\n${capture.summary}\n${capture.body}`; }

export function extractGBrainDryRun(capture: GBrainPendingCapture): GBrainExtractionResult {
  const text = textOf(capture);
  const extractedEntities = ENTITY_NAMES.filter((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  const warnings: string[] = [];
  const possibleLessons: string[] = [];
  const possibleDecisions: string[] = [];
  const memoryCandidates: GBrainMemoryCandidate[] = [];
  const addCandidate = (candidate_type: GBrainMemoryCandidate["candidate_type"], proposed_text: string, confidence: GBrainMemoryCandidate["confidence"] = "medium") => {
    memoryCandidates.push({ candidate_type, confidence, source_class: capture.sourceClass, source_capture_path: capture.relativePath, proposed_text, requires_review: true });
  };

  for (const entity of extractedEntities) addCandidate("entity", `Entity candidate observed: [[${entity}]].`, "medium");

  switch (capture.sourceClass) {
    case "execution_artifact":
      warnings.push("Execution artifact: extract content style/format candidates only; do not treat as fact.");
      addCandidate("content_pattern", `Holdstation Mini App X post activation pattern: ${capture.summary.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").slice(0, 180)}`, "medium");
      break;
    case "social_signal":
      warnings.push("Social signal is not verified fact.");
      addCandidate("positioning", `Social theme candidate: ${capture.summary.replace(/\s+/g, " ").slice(0, 180)}`, "low");
      break;
    case "weak_trend_signal":
      warnings.push("Weak trend signal; requires corroboration before use as fact.");
      addCandidate("lesson", `Weak trend observation candidate: ${capture.summary.replace(/\s+/g, " ").slice(0, 180)}`, "low");
      break;
    case "source_backed_public":
    case "official_source":
      addCandidate("lesson", `Source-backed fact candidate: ${capture.summary.slice(0, 220)}`, "high");
      break;
    case "cmo_interpretation":
      warnings.push("CMO interpretation: decision candidate only, not promoted truth.");
      possibleDecisions.push(capture.summary.slice(0, 240));
      addCandidate("decision", `Decision candidate requiring review: ${capture.summary.slice(0, 220)}`, "medium");
      break;
    default:
      warnings.push(`Unrecognized source_class '${capture.sourceClass}'; keep as review-only raw extraction.`);
      addCandidate("lesson", `Review-only extraction candidate: ${capture.summary.slice(0, 220)}`, "low");
  }

  return {
    capturePath: capture.relativePath,
    userId: capture.userId,
    workspaceId: capture.workspaceId,
    workspaceGroup: capture.workspaceGroup,
    project: capture.project,
    sourceAgent: capture.sourceAgent,
    mode: capture.mode,
    skill: capture.skill,
    sourceClass: capture.sourceClass,
    reviewStatus: capture.reviewStatus,
    summary: capture.summary,
    extractedEntities: uniq(extractedEntities.map((name) => `[[${name}]]`)),
    possibleLessons,
    possibleDecisions,
    memoryCandidates,
    warnings: uniq(warnings),
    recommendedNextAction: "dry_run_review_only",
  };
}
