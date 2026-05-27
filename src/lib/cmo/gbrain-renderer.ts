import type { GBrainExtractionResult } from "./gbrain-types";

export function renderGBrainSummaryTable(results: GBrainExtractionResult[]): string {
  const lines = ["capturePath | sourceClass | agent | candidates | warnings", "---|---|---|---:|---"];
  for (const r of results) lines.push(`${r.capturePath} | ${r.sourceClass} | ${r.sourceAgent} | ${r.memoryCandidates.length} | ${r.warnings.length}`);
  return lines.join("\n");
}

export function renderGBrainPreview(results: GBrainExtractionResult[], count = 3): string {
  return results.slice(0, count).map((r, i) => `\n[${i + 1}] ${r.capturePath}\nsource_class: ${r.sourceClass}\nentities: ${r.extractedEntities.join(", ") || "none"}\nwarnings: ${r.warnings.join("; ") || "none"}\nrecommended_next_action: ${r.recommendedNextAction}\nmemory_candidates:\n${r.memoryCandidates.map((c) => `- ${c.candidate_type}/${c.confidence}: ${c.proposed_text}`).join("\n") || "- none"}`).join("\n");
}
