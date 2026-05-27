import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { CMO_ENGINE_VAULT_PATH } from "./vault-capture-paths";
import type { GBrainExtractionResult, GBrainMemoryCandidate } from "./gbrain-types";

const CANDIDATE_FOLDER = "09 Proposals/Memory Candidates";
const VALID_TYPES = new Set(["lesson", "decision", "entity", "content_pattern", "positioning", "metric_note", "ops_learning"]);

type WriteStatus = "written" | "skipped_duplicate" | "skipped_guardrail" | "dry_run";

export interface GBrainCandidateWriteOptions { vaultRoot?: string; write?: boolean; createdAt?: string; }
export interface GBrainCandidateWriteResult {
  status: WriteStatus;
  candidateHash: string;
  relativePath?: string;
  candidateType: string;
  proposedText: string;
  reason?: string;
  markdown?: string;
  createdAt?: string;
  sourcePath?: string;
  workspaceId?: string;
  workspaceGroup?: string;
  project?: string;
  appId?: string;
  userId?: string;
  visibility?: "private" | "workspace" | "organization" | "system";
  reviewStatus?: string;
}

function sha(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function yaml(value: unknown): string { return JSON.stringify(value ?? ""); }
function slug(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/g, "") || "memory-candidate"; }
function walkMarkdown(dir: string): string[] { let out: string[] = []; try { for (const n of readdirSync(dir)) { const p = join(dir, n); const st = statSync(p); if (st.isDirectory()) out = out.concat(walkMarkdown(p)); else if (n.endsWith(".md")) out.push(p); } } catch {} return out; }
function cleanText(value: string): string { return value.replace(/^\s*#{1,6}\s+.*$/gm, " ").replace(/#{1,6}\s*/g, " ").replace(/\b(?:content\/output pattern candidate from|entity candidate observed|social theme candidate|weak trend observation candidate|candidate candidate|agent execution)\b:?/gi, " ").replace(/\s+/g, " ").trim(); }
function entityName(candidate: GBrainMemoryCandidate): string | undefined { return candidate.candidate_type === "entity" ? candidate.proposed_text.match(/\[\[([^\]]+)\]\]/)?.[1] : undefined; }
function titleSeed(result: GBrainExtractionResult, candidate: GBrainMemoryCandidate): string {
  const ent = entityName(candidate);
  if (ent) return ent;
  if (candidate.candidate_type === "content_pattern") {
    const hasActivation = /activation/i.test(candidate.proposed_text + " " + result.summary);
    const hasX = /\b(?:x|twitter|post|tweet)\b/i.test(candidate.proposed_text + " " + result.summary);
    if (/Holdstation Mini App/i.test(candidate.proposed_text + " " + result.summary)) return `Holdstation Mini App${hasX ? " X" : ""}${hasActivation ? " activation" : ""} pattern`;
  }
  if (candidate.candidate_type === "positioning" && result.sourceClass === "social_signal") {
    if (/World App/i.test(candidate.proposed_text + " " + result.summary) && /DeFi/i.test(candidate.proposed_text + " " + result.summary)) return "World App DeFi social theme";
    if (/Holdstation Mini App/i.test(candidate.proposed_text + " " + result.summary)) return "Holdstation Mini App social theme";
  }
  if (candidate.candidate_type === "lesson" && result.sourceClass === "weak_trend_signal") {
    if (/World App/i.test(candidate.proposed_text + " " + result.summary) && /DeFi/i.test(candidate.proposed_text + " " + result.summary)) return "World App DeFi weak trend observation";
  }
  return cleanText(candidate.proposed_text).slice(0, 90);
}

function allowedByGuardrail(result: GBrainExtractionResult, candidate: GBrainMemoryCandidate): string | undefined {
  if (!VALID_TYPES.has(candidate.candidate_type)) return `invalid_candidate_type:${candidate.candidate_type}`;
  if (candidate.requires_review !== true) return "requires_review_missing";
  switch (result.sourceClass) {
    case "execution_artifact": return candidate.candidate_type === "content_pattern" || candidate.candidate_type === "entity" ? undefined : "execution_artifact_content_pattern_only";
    case "social_signal": return candidate.candidate_type === "positioning" || candidate.candidate_type === "entity" ? undefined : "social_signal_theme_only";
    case "weak_trend_signal": return ["lesson", "positioning", "entity"].includes(candidate.candidate_type) ? undefined : "weak_trend_observation_only";
    case "source_backed_public":
    case "official_source": return undefined;
    case "cmo_interpretation": return candidate.candidate_type === "decision" || candidate.candidate_type === "entity" ? undefined : "cmo_interpretation_decision_only";
    case "verified_metric": return candidate.candidate_type === "metric_note" || candidate.candidate_type === "entity" ? undefined : "verified_metric_metric_note_only";
    default: return undefined;
  }
}

function existingCandidateHashes(vaultRoot: string): Set<string> {
  const dir = join(vaultRoot, CANDIDATE_FOLDER);
  const hashes = new Set<string>();
  for (const file of walkMarkdown(dir)) {
    const m = readFileSync(file, "utf8").match(/^candidate_hash:\s*"?([a-f0-9]+)"?/m);
    if (m) hashes.add(m[1]);
  }
  return hashes;
}

function warningFor(result: GBrainExtractionResult): string {
  if (result.sourceClass === "social_signal") return "Social signal is not verified fact.";
  if (result.sourceClass === "weak_trend_signal") return "Weak trend signal requires corroboration.";
  if (result.sourceClass === "execution_artifact") return "Execution artifact: content/style candidate only, not fact.";
  if (result.sourceClass === "cmo_interpretation") return "CMO interpretation: decision candidate only, not promoted truth.";
  return "Review required before any promotion.";
}

function appIdForWorkspace(result: GBrainExtractionResult): string | undefined {
  if (result.workspaceId === "world-app-holdstation-mini-app" || /holdstation mini app/i.test(result.project)) {
    return "holdstation-mini-app";
  }

  return result.workspaceId || undefined;
}

function indexMetadata(result: GBrainExtractionResult, createdAt: string) {
  return {
    createdAt,
    sourcePath: result.capturePath,
    workspaceId: result.workspaceId,
    workspaceGroup: result.workspaceGroup,
    project: result.project,
    appId: appIdForWorkspace(result),
    userId: result.userId,
    visibility: "private" as const,
    reviewStatus: "review_candidate",
  };
}

function renderCandidate(result: GBrainExtractionResult, candidate: GBrainMemoryCandidate, candidateHash: string, sourceHash: string, createdAt: string): { title: string; markdown: string } {
  const seed = titleSeed(result, candidate);
  const title = `${candidate.candidate_type}: ${seed}`;
  const proposed = cleanText(candidate.proposed_text);
  const related = result.extractedEntities;
  const markdown = `---
title: ${yaml(title)}
type: memory_candidate
vault: cmo-engine
user_id: ${yaml(result.userId)}
workspace_id: ${yaml(result.workspaceId)}
workspace_group: ${yaml(result.workspaceGroup)}
project: ${yaml(result.project)}
source_agent: ${yaml(result.sourceAgent)}
mode: ${yaml(result.mode)}
skill: ${yaml(result.skill)}
source_class: ${yaml(result.sourceClass)}
review_status: review_candidate
visibility: private
created_at: ${yaml(createdAt)}
candidate_type: ${yaml(candidate.candidate_type)}
confidence: ${yaml(candidate.confidence)}
requires_review: true
source_capture_path: ${yaml(result.capturePath)}
source_capture_hash: ${yaml(sourceHash)}
candidate_hash: ${yaml(candidateHash)}
related:${related.length ? related.map((e) => `\n - ${yaml(e)}`).join("") : " []"}
tags:
 - cmo-engine
 - memory-candidate
 - review-candidate
---

# ${title}

> [!warning] Review Required
> This is a GBrain-generated candidate. It is not promoted memory or source of truth.
> ${warningFor(result)}

## Proposed Memory
${proposed}

## Why This Was Extracted
- Candidate type: ${candidate.candidate_type}
- Confidence: ${candidate.confidence}
- Source-class guardrail: ${warningFor(result)}

## Source Capture
- Path: ${result.capturePath}
- Source class: ${result.sourceClass}
- Source agent: ${result.sourceAgent}
- Mode: ${result.mode}
- Skill: ${result.skill}

## Evidence / Quotes
${result.summary || "No summary supplied."}

## Related Entities
${related.map((e) => `- ${e}`).join("\n") || "- None detected."}

## Review Checklist
- [ ] Verify source context
- [ ] Confirm workspace relevance
- [ ] Decide approve/reject/supersede
- [ ] Promote only if stable and useful
`;
  return { title, markdown };
}

export function writeGBrainMemoryCandidates(results: GBrainExtractionResult[], options: GBrainCandidateWriteOptions = {}): GBrainCandidateWriteResult[] {
  const vaultRoot = options.vaultRoot ?? CMO_ENGINE_VAULT_PATH;
  const write = options.write === true;
  const createdAt = options.createdAt ?? new Date().toISOString();
  const dir = join(vaultRoot, CANDIDATE_FOLDER);
  const existing = existingCandidateHashes(vaultRoot);
  const out: GBrainCandidateWriteResult[] = [];
  if (write) mkdirSync(dir, { recursive: true });

  for (const result of results) {
    const sourceHash = sha(`${result.capturePath}\n${result.summary}`);
    for (const candidate of result.memoryCandidates) {
      const entity = entityName(candidate);
      const hashScope = entity ? `${result.workspaceId}\nentity\n${entity.toLowerCase()}` : `${result.capturePath}\n${candidate.candidate_type}\n${candidate.proposed_text}`;
      const candidateHash = sha(hashScope);
      const guardrail = allowedByGuardrail(result, candidate);
      const metadata = indexMetadata(result, createdAt);
      if (guardrail) { out.push({ status: "skipped_guardrail", candidateHash, candidateType: candidate.candidate_type, proposedText: candidate.proposed_text, reason: guardrail, ...metadata }); continue; }
      const rendered = renderCandidate(result, candidate, candidateHash, sourceHash, createdAt);
      const filename = `${createdAt.slice(0, 10)} - ${slug(candidate.candidate_type)} - ${slug(titleSeed(result, candidate))} - ${candidateHash}.md`;
      const abs = join(dir, filename);
      const rel = relative(vaultRoot, abs);
      if (!rel.startsWith(CANDIDATE_FOLDER + "/")) throw new Error(`Candidate path escapes proposal folder: ${rel}`);
      if (existing.has(candidateHash) || existsSync(abs)) { out.push({ status: "skipped_duplicate", candidateHash, relativePath: rel, candidateType: candidate.candidate_type, proposedText: candidate.proposed_text, ...metadata }); continue; }
      if (write) { writeFileSync(abs, rendered.markdown); existing.add(candidateHash); }
      out.push({ status: write ? "written" : "dry_run", candidateHash, relativePath: rel, candidateType: candidate.candidate_type, proposedText: candidate.proposed_text, markdown: write ? undefined : rendered.markdown, ...metadata });
    }
  }
  return out;
}

export const GBRAIN_CANDIDATE_FOLDER = CANDIDATE_FOLDER;
