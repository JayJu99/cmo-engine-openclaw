import type { CMOContextQuality, CMOContextQualitySummary, VaultNoteRef } from "@/lib/cmo/app-workspace-types";

interface ContextQualityInput {
  title: string;
  exists: boolean;
  content?: string | null;
  missingReason?: string;
}

export interface ContextQualityResult {
  frontmatterStatus?: string;
  contextQuality: CMOContextQuality;
  qualityReason: string;
}

const durablePlaceholderPatterns = [
  /no durable .+ confirmed/i,
  /no durable .+ recorded/i,
  /no durable .+ have been recorded/i,
  /no confirmed .+ recorded/i,
  /no validated learnings/i,
  /add confirmed .+ here/i,
  /add verified .+ here/i,
  /add learnings only when/i,
  /none yet\./i,
];

function stripFrontmatter(content: string): string {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

export function extractFrontmatterStatus(content: string): string | undefined {
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = match?.[1];

  if (!frontmatter) {
    return undefined;
  }

  const statusMatch = frontmatter.match(/^status:\s*["']?([^"'\r\n#]+)["']?\s*(?:#.*)?$/im);
  const status = statusMatch?.[1]?.trim().toLowerCase();

  return status || undefined;
}

function hasPlaceholderLanguage(content: string): boolean {
  const body = stripFrontmatter(content);
  const hasExplicitPlaceholder = durablePlaceholderPatterns.some((pattern) => pattern.test(body));
  const hasWorkingNotes = /^##\s+Working Notes\s*$/im.test(body);
  const hasOpenQuestions = /^##\s+Open (Questions|Decisions)\s*$/im.test(body);

  return hasExplicitPlaceholder || (hasWorkingNotes && hasOpenQuestions);
}

function noteSubject(title: string): string {
  return title.trim().toLowerCase() || "context";
}

export function analyzeContextQuality(input: ContextQualityInput): ContextQualityResult {
  if (!input.exists) {
    return {
      contextQuality: "missing",
      qualityReason: input.missingReason || "Selected note file was not found.",
    };
  }

  const content = input.content ?? "";
  const frontmatterStatus = extractFrontmatterStatus(content);
  const normalizedStatus = frontmatterStatus?.toLowerCase();

  if (normalizedStatus === "placeholder") {
    return {
      frontmatterStatus,
      contextQuality: "placeholder",
      qualityReason: "Frontmatter status is placeholder.",
    };
  }

  if (normalizedStatus === "confirmed" || normalizedStatus === "active") {
    return {
      frontmatterStatus,
      contextQuality: "confirmed",
      qualityReason: `Frontmatter status is ${frontmatterStatus}; note is treated as confirmed app context.`,
    };
  }

  if (normalizedStatus === "draft") {
    return {
      frontmatterStatus,
      contextQuality: "draft",
      qualityReason: "Frontmatter status is draft; note exists but has not been confirmed.",
    };
  }

  if (hasPlaceholderLanguage(content)) {
    return {
      ...(frontmatterStatus ? { frontmatterStatus } : {}),
      contextQuality: "placeholder",
      qualityReason: `Seed placeholder note; no confirmed app ${noteSubject(input.title)} yet.`,
    };
  }

  return {
    ...(frontmatterStatus ? { frontmatterStatus } : {}),
    contextQuality: "draft",
    qualityReason: frontmatterStatus
      ? `Frontmatter status is ${frontmatterStatus}; note is treated as draft until confirmed.`
      : "Note exists, but no status frontmatter was found; treated as draft.",
  };
}

export function summarizeContextQuality(notes: Array<Pick<VaultNoteRef, "exists" | "contextQuality">>): CMOContextQualitySummary {
  const selectedCount = notes.length;
  const existingCount = notes.filter((note) => note.exists !== false && note.contextQuality !== "missing").length;
  const missingCount = notes.filter((note) => note.exists === false || note.contextQuality === "missing").length;
  const confirmedCount = notes.filter((note) => note.contextQuality === "confirmed").length;
  const draftCount = notes.filter((note) => note.contextQuality === "draft").length;
  const placeholderCount = notes.filter((note) => note.contextQuality === "placeholder").length;

  return {
    selectedCount,
    existingCount,
    missingCount,
    confirmedCount,
    draftCount,
    placeholderCount,
    placeholderOrDraftCount: placeholderCount + draftCount,
  };
}
