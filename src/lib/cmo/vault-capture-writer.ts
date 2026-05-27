import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";

import { buildCaptureTarget, CMO_ENGINE_VAULT_PATH } from "./vault-capture-paths";
import { renderCaptureMarkdown } from "./vault-capture-renderer";
import { indexVaultCapture } from "./supabase-indexing";
import type { CMOVaultCaptureEvent, CMOVaultCaptureTarget } from "./vault-capture-types";

const KNOWN_CAPTURE_FOLDERS = new Set([
  "03 Sessions/Raw",
  "04 Research/Surf Packs",
  "05 Social Signals/Surf X",
  "06 Trend Signals/Last30Days",
  "07 Content Outputs/Echo",
  "08 Decisions/Draft Decisions",
  "09 Proposals/Memory Candidates",
  "11 Ops/Runtime",
]);

export interface CMOVaultCaptureSaveResult {
  ok: boolean;
  savedToVault: true;
  target: CMOVaultCaptureTarget;
  writtenPath: string;
  relativePath: string;
  markdown: string;
  warnings: string[];
}

export function cmoEngineVaultRoot(): string {
  return process.env.CMO_ENGINE_VAULT_PATH || CMO_ENGINE_VAULT_PATH;
}

function assertSafeTarget(target: CMOVaultCaptureTarget, vaultRoot = cmoEngineVaultRoot()): string {
  if (!target.relativePath.endsWith(".md")) throw new Error("Capture target must be a markdown file");
  if (target.relativePath.includes("\0") || target.folder.includes("\0") || target.filename.includes("\0")) throw new Error("Invalid null byte in target path");
  if (isAbsolute(target.relativePath) || target.relativePath.split(/[\\/]/).includes("..")) throw new Error("Path traversal is not allowed");
  if (!KNOWN_CAPTURE_FOLDERS.has(target.folder)) throw new Error(`Unknown capture folder: ${target.folder}`);
  if (target.relativePath !== `${target.folder}/${target.filename}`) throw new Error("Capture target path mismatch");

  const root = resolve(vaultRoot);
  const absolute = resolve(root, target.relativePath);
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Capture target escapes CMO Engine Vault");
  return absolute;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function withCounter(path: string, counter: number): string {
  return path.replace(/\.md$/, ` - ${String(counter).padStart(2, "0")}.md`);
}

async function resolveCollision(path: string): Promise<string> {
  if (!(await exists(path))) return path;
  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = withCounter(path, counter);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("Could not resolve capture filename collision");
}

export async function saveCaptureToCmoEngineVault(event: CMOVaultCaptureEvent, options: { idempotencyKey?: string; turnIdempotencyKey?: string } = {}): Promise<CMOVaultCaptureSaveResult> {
  const target = buildCaptureTarget(event);
  const markdown = renderCaptureMarkdown(event);
  const idempotencyKey = options.idempotencyKey?.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 160);
  const turnIdempotencyKey = options.turnIdempotencyKey?.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 220);
  const indexPath = idempotencyKey ? resolve(cmoEngineVaultRoot(), ".cmo-auto-capture-index", `${idempotencyKey}.json`) : undefined;
  const turnIndexPath = turnIdempotencyKey ? resolve(cmoEngineVaultRoot(), ".cmo-auto-capture-index", `${turnIdempotencyKey}.json`) : undefined;
  for (const candidateIndexPath of [indexPath, turnIndexPath].filter(Boolean) as string[]) {
    if (await exists(candidateIndexPath)) {
      const prior = JSON.parse(await readFile(candidateIndexPath, "utf8")) as { writtenPath: string; relativePath: string; target: CMOVaultCaptureTarget; warnings?: string[] };
      return { ok: true, savedToVault: true, target: prior.target, writtenPath: prior.writtenPath, relativePath: prior.relativePath, markdown, warnings: prior.warnings ?? [] };
    }
  }
  const safePath = assertSafeTarget(target);
  const finalPath = await resolveCollision(safePath);
  const root = resolve(cmoEngineVaultRoot());
  const finalRelative = normalize(relative(root, finalPath)).replace(/\\/g, "/");

  await mkdir(dirname(finalPath), { recursive: true });
  await writeFile(finalPath, markdown, { encoding: "utf8", flag: "wx" });
  const indexPayload = JSON.stringify({ writtenPath: finalPath, relativePath: finalRelative, target: { ...target, relativePath: finalRelative, filename: finalRelative.split("/").pop() || target.filename }, warnings: [] }, null, 2);
  for (const candidateIndexPath of [indexPath, turnIndexPath].filter(Boolean) as string[]) {
    await mkdir(dirname(candidateIndexPath), { recursive: true });
    await writeFile(candidateIndexPath, indexPayload, { encoding: "utf8", flag: "wx" });
  }
  await indexVaultCapture({
    event,
    relativePath: finalRelative,
  });

  return {
    ok: true,
    savedToVault: true,
    target: { ...target, relativePath: finalRelative, filename: finalRelative.split("/").pop() || target.filename },
    writtenPath: finalPath,
    relativePath: finalRelative,
    markdown,
    warnings: [],
  };
}

export const __vaultCaptureWriterTest = { assertSafeTarget };
