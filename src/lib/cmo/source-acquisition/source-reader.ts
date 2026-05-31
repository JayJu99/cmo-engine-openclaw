import type {
  CmoSessionLocalSource,
  CmoSessionSourceCacheRole,
  CmoSessionSourceReadDepth,
  CmoSourceAnswerContext,
  CmoSourceQualityReport,
} from "@/lib/cmo/app-workspace-types";
import { extractText, fetchPublicUrl } from "@/lib/cmo/source-acquisition";

const MAX_QUERY_SNIPPETS = 5;
const MAX_SNIPPET_CHARS = 700;
const MAX_CACHE_CHARS = 16_000;
const SUMMARY_SNIPPET_CHARS = 900;
const TRANSLATE_SNIPPET_CHARS = 1_800;

type SourceReaderQueryType = CmoSourceAnswerContext["query_type"];
type SourceReaderAction = CmoSourceAnswerContext["action"];
type UsedSourceField = CmoSourceAnswerContext["used_source_fields"][number];

const STOPWORDS = new Set<string>([
  "a",
  "an",
  "and",
  "are",
  "about",
  "can",
  "bro",
  "cho",
  "co",
  "có",
  "cua",
  "của",
  "duoc",
  "được",
  "for",
  "gi",
  "gì",
  "giup",
  "giúp",
  "help",
  "in",
  "is",
  "la",
  "là",
  "ok",
  "okay",
  "minh",
  "mình",
  "nay",
  "này",
  "the",
  "thanks",
  "thi",
  "thì",
  "to",
  "trong",
  "voi",
  "với",
  "what",
  "which",
]);

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function bounded(value: string, maxChars: number): string {
  const normalized = compact(value);

  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 3).trimEnd()}...` : normalized;
}

function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

function queryTokens(query: string): string[] {
  const normalized = normalizeForSearch(query);
  const tokens: string[] = normalized.match(/[\p{Letter}\p{Number}]{3,}/gu) ?? [];

  return [...new Set(tokens.filter((token) => !STOPWORDS.has(token)))].slice(0, 12);
}

function hasAnyToken(query: string, values: string[]): boolean {
  const normalized = normalizeForSearch(query);
  const tokens: string[] = normalized.match(/[\p{Letter}\p{Number}]{2,}/gu) ?? [];

  return values.some((value) => tokens.includes(value) || normalized.includes(value));
}

export function detectSourceReaderAction(query: string): { query_type: SourceReaderQueryType; action: SourceReaderAction } {
  if (hasAnyToken(query, ["translate", "translation", "dich"])) {
    return { query_type: "translate", action: "translate" };
  }

  if (hasAnyToken(query, ["summary", "summarize", "summarise", "recap", "brief", "tom", "tat"])) {
    return { query_type: "summarize", action: "summarize" };
  }

  if (hasAnyToken(query, ["review", "audit", "analyze", "analyse", "check", "danh", "gia"])) {
    return { query_type: "review", action: "review" };
  }

  if (hasAnyToken(query, ["read", "doc", "access", "open", "fetch", "load"])) {
    return { query_type: "can_read", action: "can_read" };
  }

  if (query.includes("?") || hasAnyToken(query, ["what", "which", "where", "when", "who", "why", "how", "gi", "nao", "dau", "bao", "khong"])) {
    return { query_type: "specific_question", action: "answer_question" };
  }

  return { query_type: "unknown", action: "unknown" };
}

function candidatePassages(text: string): string[] {
  return text
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9À-ỹ])/u)
    .map(compact)
    .filter((part) => part.length >= 30)
    .slice(0, 240);
}

function scoredSnippets(text: string, query: string): string[] {
  const tokens = queryTokens(query);

  if (!tokens.length) {
    return [];
  }

  return candidatePassages(text)
    .map((passage) => {
      const searchable = normalizeForSearch(passage);
      const score = tokens.reduce((total, token) => total + (searchable.includes(token) ? 1 : 0), 0);

      return { passage, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.passage.length - right.passage.length)
    .slice(0, MAX_QUERY_SNIPPETS)
    .map((item) => bounded(item.passage, MAX_SNIPPET_CHARS));
}

function usedSourceFields(source: CmoSessionLocalSource): UsedSourceField[] {
  return [
    source.extracted_summary ? "extracted_summary" : null,
    source.source_text_cache ? "source_text_cache" : null,
    source.source_text_excerpt ? "source_text_excerpt" : null,
  ].filter((field): field is UsedSourceField => Boolean(field));
}

function representativeSnippets(source: CmoSessionLocalSource, maxChars: number): string[] {
  return [
    source.extracted_summary ? bounded(source.extracted_summary, Math.min(500, maxChars)) : "",
    source.source_text_cache ? bounded(source.source_text_cache, maxChars) : "",
    !source.source_text_cache && source.source_text_excerpt ? bounded(source.source_text_excerpt, maxChars) : "",
  ].filter(Boolean).slice(0, MAX_QUERY_SNIPPETS);
}

function hasEnoughBroadSourceContent(source: CmoSessionLocalSource): boolean {
  const summaryLength = compact(source.extracted_summary ?? "").length;
  const textLength = compact(source.source_text_cache ?? source.source_text_excerpt ?? "").length;

  return summaryLength >= 40 || textLength >= 80;
}

function isGenericSourceReadIntent(intent: { query_type: SourceReaderQueryType }): boolean {
  return intent.query_type === "summarize" || intent.query_type === "review" || intent.query_type === "can_read";
}

function extractionStatus(source: CmoSessionLocalSource): CmoSourceQualityReport["extraction_status"] {
  return source.extraction_status === "completed" || source.extraction_status === "partial" ? source.extraction_status : "failed";
}

function warningList(source: CmoSessionLocalSource): string[] {
  return Array.isArray(source.warnings) ? source.warnings.filter((warning): warning is string => typeof warning === "string") : [];
}

function textForQuality(source: CmoSessionLocalSource): string {
  return [source.source_text_cache, source.source_text_excerpt, source.extracted_summary].filter(Boolean).join("\n\n");
}

export function buildSourceQualityReport(source: CmoSessionLocalSource): CmoSourceQualityReport {
  const warnings = new Set(warningList(source));
  const text = textForQuality(source);
  const normalized = normalizeForSearch(text);
  const words = normalized.match(/[\p{Letter}\p{Number}]{2,}/gu) ?? [];
  const uniqueWords = new Set(words);
  const navWords = ["home", "menu", "login", "sign", "privacy", "terms", "docs", "blog", "contact", "copyright"];
  const navHits = navWords.reduce((total, word) => total + (normalized.includes(word) ? 1 : 0), 0);
  const navHeavy = text.length < 900 || (navHits >= 5 && uniqueWords.size < 80);

  if (navHeavy) {
    warnings.add("nav_heavy");
  }
  if (source.source_text_cache && source.source_text_cache.includes("[truncated]")) {
    warnings.add("truncated");
  }
  if (source.original_url && !source.source_text_cache) {
    warnings.add("dynamic_content_possible");
  }

  const status = extractionStatus(source);
  const quality: CmoSourceQualityReport["main_content_quality"] =
    status === "failed" || text.length < 250
      ? "low"
      : navHeavy || status === "partial" || warnings.has("truncated")
        ? "partial"
        : "good";

  return {
    extraction_status: status,
    main_content_quality: source.main_content_quality ?? quality,
    extraction_coverage: source.extraction_coverage ?? (source.original_url ? "static_html" : "partial"),
    warnings: [...warnings],
  };
}

function sourceIsNavHeavy(quality: CmoSourceQualityReport): boolean {
  return quality.warnings.includes("nav_heavy");
}

export function sourceReadDepth(source: CmoSessionLocalSource, quality = buildSourceQualityReport(source)): CmoSessionSourceReadDepth {
  if (sourceIsNavHeavy(quality) || quality.main_content_quality === "low" || quality.extraction_status === "partial") {
    return "partial";
  }

  if (quality.extraction_coverage === "rendered_dom") {
    return "browser_rendered";
  }

  if (quality.extraction_coverage === "deep_crawl") {
    return "full_doc";
  }

  if (source.source_text_cache || source.extracted_summary) {
    return "extracted_text";
  }

  return "snippet";
}

export function sourceCacheRole(source: CmoSessionLocalSource, quality = buildSourceQualityReport(source)): CmoSessionSourceCacheRole {
  const navHeavy = sourceIsNavHeavy(quality);

  if (quality.extraction_status === "completed" && quality.main_content_quality === "good" && !navHeavy) {
    return "high_quality_evidence";
  }

  if (source.original_url && (navHeavy || quality.main_content_quality === "low" || quality.extraction_status === "partial")) {
    return "fallback_only";
  }

  return "context_hint";
}

export function sourceToolReadRecommended(
  source: CmoSessionLocalSource,
  intent: { query_type: SourceReaderQueryType } = { query_type: "unknown" },
  quality = buildSourceQualityReport(source),
): boolean {
  if (!source.original_url && !source.canonical_url) {
    return false;
  }

  const role = sourceCacheRole(source, quality);

  return (
    sourceIsNavHeavy(quality) ||
    quality.main_content_quality !== "good" ||
    quality.extraction_status !== "completed" ||
    (isGenericSourceReadIntent(intent) && role !== "high_quality_evidence")
  );
}

export function readSessionLocalSource(source: CmoSessionLocalSource): string {
  return [source.source_text_cache, source.source_text_excerpt, source.extracted_summary].filter(Boolean).join("\n\n").slice(0, MAX_CACHE_CHARS);
}

export function querySessionLocalSource(source: CmoSessionLocalSource, query: string): CmoSourceAnswerContext {
  const quality = buildSourceQualityReport(source);
  const text = readSessionLocalSource(source);
  const intent = detectSourceReaderAction(query);
  const cacheRole = sourceCacheRole(source, quality);
  const readDepth = sourceReadDepth(source, quality);
  const navHeavy = sourceIsNavHeavy(quality);
  const toolReadRecommended = sourceToolReadRecommended(source, intent, quality);
  const cacheCanAnswer = cacheRole === "high_quality_evidence";
  const fields = usedSourceFields(source);
  let relevantSnippets: string[] = [];
  let answerable = false;
  let reason: CmoSourceAnswerContext["reason"];

  if (intent.query_type === "summarize" || intent.query_type === "review") {
    answerable = cacheCanAnswer && hasEnoughBroadSourceContent(source);
    relevantSnippets = answerable ? representativeSnippets(source, SUMMARY_SNIPPET_CHARS) : [];
    reason = answerable ? undefined : "extraction_partial";
  } else if (intent.query_type === "translate") {
    answerable = cacheCanAnswer && Boolean(compact(source.source_text_cache ?? source.source_text_excerpt ?? source.extracted_summary ?? ""));
    relevantSnippets = answerable ? representativeSnippets(source, TRANSLATE_SNIPPET_CHARS) : [];
    reason = answerable ? undefined : "extraction_partial";
  } else if (intent.query_type === "can_read") {
    answerable = cacheCanAnswer && (quality.extraction_status === "completed" || quality.extraction_status === "partial");
    relevantSnippets = answerable ? representativeSnippets(source, SUMMARY_SNIPPET_CHARS) : [];
    reason = answerable ? undefined : "extraction_partial";
  } else {
    relevantSnippets = scoredSnippets(text, query);
    answerable = cacheCanAnswer && relevantSnippets.length > 0;
    reason = answerable ? undefined : "not_found_in_current_extraction";
  }

  return {
    type: "source_answer_context",
    schema_version: "cmo.source_answer_context.v1",
    workspace_id: source.workspace_id,
    session_id: source.session_id,
    source_id: source.source_id,
    query,
    query_type: intent.query_type,
    action: intent.action,
    answerable,
    relevant_snippets: relevantSnippets,
    used_source_fields: fields,
    source_title: source.source_title,
    ...(source.original_url ? { original_url: source.original_url } : {}),
    ...(source.canonical_url ? { canonical_url: source.canonical_url } : {}),
    ...(source.content_hash ? { content_hash: source.content_hash } : {}),
    truth_status: "session_only",
    saved_to_vault: false,
    no_auto_promote: true,
    extraction_quality: quality.main_content_quality,
    extraction_coverage: quality.extraction_coverage,
    read_depth: readDepth,
    cache_role: cacheRole,
    nav_heavy: navHeavy,
    tool_read_recommended: toolReadRecommended,
    warnings: quality.warnings,
    ...(!answerable
      ? {
          reason: reason ?? (quality.main_content_quality === "low" || quality.main_content_quality === "partial"
            ? "extraction_partial" as const
            : "not_found_in_current_extraction" as const),
          suggested_next_step: "deep_read_or_rendered_fetch" as const,
        }
      : {}),
  };
}

export async function fetchMoreFromSourceUrl(source: CmoSessionLocalSource, nowIso?: string): Promise<CmoSessionLocalSource | undefined> {
  const url = source.canonical_url ?? source.original_url;

  if (!url) {
    return undefined;
  }

  const fetched = await fetchPublicUrl(url, nowIso);
  if (fetched.status !== "completed" || !fetched.body) {
    return {
      ...source,
      main_content_quality: "partial",
      extraction_coverage: "partial",
      warnings: [...warningList(source), ...fetched.warnings, ...fetched.errors, "deep_read_fetch_failed"],
    };
  }

  const fetchedText = fetched.text ?? new TextDecoder("utf-8", { fatal: false }).decode(fetched.body);
  const extraction = extractText(fetchedText, { mimeType: fetched.mime_type });
  const cache = extraction.source_text.slice(0, MAX_CACHE_CHARS);
  const quality = buildSourceQualityReport({
    ...source,
    source_text_cache: cache,
    extraction_status: extraction.status === "completed" ? "completed" : "partial",
    warnings: [...warningList(source), ...fetched.warnings, ...extraction.warnings],
  });

  return {
    ...source,
    canonical_url: fetched.canonical_url ?? source.canonical_url,
    source_text_cache: cache,
    source_text_excerpt: source.source_text_excerpt ?? cache.slice(0, 1200),
    extracted_summary: extraction.extracted_summary || source.extracted_summary,
    extraction_status: extraction.status === "completed" ? "completed" : "partial",
    content_hash: source.content_hash ?? `sha256:${extraction.content_hash}`,
    main_content_quality: quality.main_content_quality,
    extraction_coverage: "static_html",
    warnings: quality.warnings,
  };
}

export async function buildSourceAnswerContext(input: {
  source?: CmoSessionLocalSource;
  query: string;
  workspaceId: string;
  sessionId: string;
  nowIso?: string;
  allowRefetch?: boolean;
}): Promise<CmoSourceAnswerContext | undefined> {
  if (!input.source || input.source.workspace_id !== input.workspaceId || input.source.session_id !== input.sessionId) {
    return undefined;
  }

  if (!queryTokens(input.query).length) {
    return undefined;
  }

  const initial = querySessionLocalSource(input.source, input.query);
  if (initial.answerable || !input.allowRefetch) {
    return initial;
  }

  const refreshed = await fetchMoreFromSourceUrl(input.source, input.nowIso);
  if (!refreshed) {
    return initial;
  }

  const next = querySessionLocalSource(refreshed, input.query);
  next.used_source_fields = [...new Set([...next.used_source_fields, "refetch" as const])];

  return next.answerable ? next : initial;
}
