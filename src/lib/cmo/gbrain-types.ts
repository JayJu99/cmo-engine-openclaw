export type GBrainSourceClass = "execution_artifact" | "social_signal" | "weak_trend_signal" | "source_backed_public" | "official_source" | "cmo_interpretation" | string;

export type GBrainCandidateType = "lesson" | "decision" | "entity" | "content_pattern" | "positioning" | "metric_note";
export type GBrainConfidence = "low" | "medium" | "high";

export interface GBrainPendingCapture {
  capturePath: string;
  relativePath: string;
  userId: string;
  workspaceId: string;
  workspaceGroup: string;
  project: string;
  sourceAgent: string;
  mode: string;
  skill: string;
  sourceClass: GBrainSourceClass;
  reviewStatus: string;
  title: string;
  summary: string;
  body: string;
  frontmatter: Record<string, string>;
}

export interface GBrainMemoryCandidate {
  candidate_type: GBrainCandidateType;
  confidence: GBrainConfidence;
  source_class: GBrainSourceClass;
  source_capture_path: string;
  proposed_text: string;
  requires_review: true;
}

export interface GBrainExtractionResult {
  capturePath: string;
  userId: string;
  workspaceId: string;
  workspaceGroup: string;
  project: string;
  sourceAgent: string;
  mode: string;
  skill: string;
  sourceClass: GBrainSourceClass;
  reviewStatus: string;
  summary: string;
  extractedEntities: string[];
  possibleLessons: string[];
  possibleDecisions: string[];
  memoryCandidates: GBrainMemoryCandidate[];
  warnings: string[];
  recommendedNextAction: string;
}

export interface GBrainScanOptions {
  vaultRoot?: string;
  limit?: number;
  workspaceId?: string;
  sourceClass?: string;
}
