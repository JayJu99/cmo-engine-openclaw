import type { CMOVaultCaptureEvent, CMOVaultCaptureTarget } from "./vault-capture-types";

export const CMO_ENGINE_VAULT_PATH = "/home/ju/.openclaw/workspace/knowledge/cmo-engine-vault";
const MAX_SLUG_LENGTH = 80;

export function extractCaptureTestMarker(value = ""): string | undefined {
  const marker = value.match(/(?:unique\s+marker\s*:\s*|\b)(echo|x|trend)-final-[a-z0-9-]+|(?:unique\s+marker\s*:\s*)(echo|x|trend|pulse|surf)-only-[a-z0-9-]+/i);
  return marker?.[0]?.replace(/^unique\s+marker\s*:\s*/i, "").replace(/[.\s]+$/g, "");
}

function cleanCaptureTopic(value: string | undefined, fallback: string): string {
  let text = (value || fallback).trim();
  text = text
    .replace(/^\s*(?:\/|@)echo\b/i, " ")
    .replace(/^\s*(?:\/|@)surf\s+x\b/i, " ")
    .replace(/^\s*\/x\b/i, " ")
    .replace(/^\s*(?:\/|@)trend\b/i, " ")
    .replace(/^\s*(?:\/|@)pulse\b/i, " ")
    .replace(/^\s*(?:\/|@)surf\b/i, " ");
  text = text.replace(/\bunique\s+marker\s*:\s*[a-z0-9-]+\b[.]?/gi, " ");
  text = text.replace(/\b(?:echo|x|trend|pulse|surf)-(?:final|only)-[a-z0-9-]+\b[.]?/gi, " ");
  text = text.replace(/^\s*(?:write|draft|create|generate|research|find|summarize)\b\s*/i, "");
  text = text.replace(/^\s*\d+\s+(?:short\s+)?(?:x|twitter|telegram|facebook|content)?\s*(?:posts?|tweets?|copies|variants?)\s+(?:about\s+)?/i, "");
  text = text.replace(/\b(?:last\s+\d+\s+days?|max\s+\d+)\b/gi, " ");
  text = text.replace(/\babout\b/gi, " ");
  return text.replace(/\s+/g, " ").replace(/[.\s]+$/g, "").trim() || fallback;
}

export function slugifyCapturePart(value: string | undefined, fallback: string): string {
  const base = (value || fallback).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const slug = base
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function captureDate(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt.slice(0, 10) || new Date(0).toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function buildCaptureTarget(event: CMOVaultCaptureEvent): CMOVaultCaptureTarget {
  const date = captureDate(event.createdAt);
  const topic = slugifyCapturePart(cleanCaptureTopic(event.topic || event.title || event.summary, "capture"), "capture");
  const platformFallback = event.type === "echo_output" && /\b(x|twitter|tweet|post)\b/i.test([event.platform, event.summary, ...(event.keyFindings ?? [])].join(" ")) ? "x" : "content";
  const platform = slugifyCapturePart(event.platform, platformFallback);
  let folder: string;
  let filename: string;

  switch (event.type) {
    case "cmo_session":
      folder = "03 Sessions/Raw";
      filename = `${date} - ${topic}.md`;
      break;
    case "echo_output":
      folder = "07 Content Outputs/Echo";
      filename = `${date} - ${platform} - ${topic}.md`;
      break;
    case "surf_research":
      folder = "04 Research/Surf Packs";
      filename = `${date} - ${topic}.md`;
      break;
    case "surf_x_signal":
      folder = "05 Social Signals/Surf X";
      filename = `${date} - ${topic} - X Signal.md`;
      break;
    case "last30days_trend":
      folder = "06 Trend Signals/Last30Days";
      filename = `${date} - ${topic} - Trend.md`;
      break;
    case "pulse_pack":
      folder = "06 Trend Signals/Last30Days";
      filename = `${date} - ${topic} - Pulse.md`;
      break;
    case "cmo_decision":
      folder = "08 Decisions/Draft Decisions";
      filename = `${date} - ${topic}.md`;
      break;
    case "memory_candidate":
      folder = "09 Proposals/Memory Candidates";
      filename = `${date} - ${topic}.md`;
      break;
    case "ops_event":
      folder = "11 Ops/Runtime";
      filename = `${date} - ${topic}.md`;
      break;
  }

  return {
    vaultId: "cmo-engine",
    vaultPath: CMO_ENGINE_VAULT_PATH,
    folder,
    filename,
    relativePath: `${folder}/${filename}`,
    collisionPolicy: "append-counter",
  };
}
