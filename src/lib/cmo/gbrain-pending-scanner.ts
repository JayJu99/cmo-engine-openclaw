import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CMO_ENGINE_VAULT_PATH } from "./vault-capture-paths";
import type { GBrainPendingCapture, GBrainScanOptions } from "./gbrain-types";

const SUPPORTED_FOLDERS = [
  "03 Sessions/Raw",
  "04 Research/Surf Packs",
  "05 Social Signals/Surf X",
  "06 Trend Signals/Last30Days",
  "07 Content Outputs/Echo",
  "08 Decisions/Draft Decisions",
];

function walkMarkdown(dir: string): string[] {
  let out: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) out = out.concat(walkMarkdown(path));
      else if (name.endsWith(".md")) out.push(path);
    }
  } catch { /* folder may not exist yet */ }
  return out;
}

export function parseSimpleFrontmatter(markdown: string): { frontmatter: Record<string, string>; body: string } {
  if (!markdown.startsWith("---\n")) return { frontmatter: {}, body: markdown };
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: markdown };
  const raw = markdown.slice(4, end).split("\n");
  const frontmatter: Record<string, string> = {};
  for (const line of raw) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    }
    frontmatter[m[1]] = value;
  }
  return { frontmatter, body: markdown.slice(end + 5).trim() };
}

export function scanPendingGBrainCaptures(options: GBrainScanOptions = {}): GBrainPendingCapture[] {
  const vaultRoot = options.vaultRoot ?? CMO_ENGINE_VAULT_PATH;
  const files = SUPPORTED_FOLDERS.flatMap((folder) => walkMarkdown(join(vaultRoot, folder))).sort();
  const captures: GBrainPendingCapture[] = [];
  for (const file of files) {
    const markdown = readFileSync(file, "utf8");
    const { frontmatter, body } = parseSimpleFrontmatter(markdown);
    if (frontmatter.gbrain_status !== "pending" || frontmatter.capture_origin !== "auto") continue;
    if (options.workspaceId && frontmatter.workspace_id !== options.workspaceId) continue;
    if (options.sourceClass && frontmatter.source_class !== options.sourceClass) continue;
    const summary = body.match(/## Summary\n([\s\S]*?)(?:\n## |$)/)?.[1]?.trim() || frontmatter.title || "";
    captures.push({
      capturePath: file,
      relativePath: relative(vaultRoot, file),
      userId: frontmatter.user_id || "",
      workspaceId: frontmatter.workspace_id || "",
      workspaceGroup: frontmatter.workspace_group || "",
      project: frontmatter.project || "",
      sourceAgent: frontmatter.source_agent || "",
      mode: frontmatter.mode || "",
      skill: frontmatter.skill || "",
      sourceClass: frontmatter.source_class || "",
      reviewStatus: frontmatter.review_status || "",
      title: frontmatter.title || "",
      summary,
      body,
      frontmatter,
    });
    if (options.limit && captures.length >= options.limit) break;
  }
  return captures;
}
