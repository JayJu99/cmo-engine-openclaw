#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DOC_TYPES = [
  ["audience", "audience", "project-audience.md", "Audience"],
  ["positioning", "positioning", "project-positioning.md", "Positioning"],
  ["product-truth", "product-truth", "project-product-truth.md", "Product Truth"],
  ["campaign-rules", "campaign-rules", "project-campaign-rules.md", "Campaign Rules"],
  ["content-pillars", "content-pillars", "project-content-pillars.md", "Content Pillars"],
];

function parseArgs(argv) {
  const args = { write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      args.write = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function requireSlug(value, label) {
  if (!value || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value)) {
    throw new Error(`${label} must be a lowercase slug`);
  }
  return value;
}

function requirePath(args, key) {
  const value = args[key];
  if (!value) {
    throw new Error(`Missing --${key}`);
  }
  return resolve(String(value));
}

function frontmatter(fields) {
  return ["---", ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`), "---", ""].join("\n");
}

function sourceNote({ workspaceId, projectName, type, title, body }) {
  return `${frontmatter({
    record_type: "source_note",
    workspace_id: workspaceId,
    project_name: projectName,
    visibility: "workspace",
    source_type: "project_context",
    project_context_type: type,
  })}# ${projectName} — ${title}\n\n${body.trim()}\n`;
}

function acceptedNote({ workspaceId, projectName, type, title, sourcePath, body }) {
  return `${frontmatter({
    record_type: "workspace_knowledge",
    workspace_id: workspaceId,
    truth_status: "accepted",
    review_status: "accepted",
    visibility: "workspace",
    source_type: "project_context",
    project_context_type: type,
    source_note_path: sourcePath,
  })}# ${projectName} — ${title}\n\n${body.trim()}\n`;
}

function writeIfRequested({ write, vaultRoot, relativePath, content }) {
  const absolutePath = resolve(vaultRoot, relativePath);
  if (!absolutePath.startsWith(`${resolve(vaultRoot)}/`) && absolutePath !== resolve(vaultRoot)) {
    throw new Error(`Refusing unsafe path: ${relativePath}`);
  }
  if (write) {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceId = requireSlug(args["workspace-id"], "workspace_id");
  const projectName = String(args["project-name"] ?? workspaceId);
  const vaultRoot = resolve(String(args["vault-root"] ?? "knowledge/holdstation"));
  const rows = [];

  for (const [argKey, sourceFileName, acceptedFileName, title] of DOC_TYPES) {
    const inputPath = requirePath(args, argKey);
    const body = readFileSync(inputPath, "utf8");
    const sourcePath = `13 Sources/Source Notes/${workspaceId}/project-context/${sourceFileName}.md`;
    const acceptedPath = `12 Knowledge/Workspace Lessons/${workspaceId}/${acceptedFileName}`;

    writeIfRequested({
      write: args.write,
      vaultRoot,
      relativePath: sourcePath,
      content: sourceNote({ workspaceId, projectName, type: sourceFileName, title, body }),
    });
    writeIfRequested({
      write: args.write,
      vaultRoot,
      relativePath: acceptedPath,
      content: acceptedNote({ workspaceId, projectName, type: sourceFileName, title, sourcePath, body }),
    });
    rows.push({ type: sourceFileName, source_path: sourcePath, accepted_path: acceptedPath });
  }

  console.log([
    `workspace_id: ${workspaceId}`,
    `project_name: ${projectName}`,
    `vault_root: ${vaultRoot}`,
    `dry_run: ${args.write ? "false" : "true"}`,
    `write_performed: ${args.write ? "true" : "false"}`,
    "created_or_updated:",
    ...rows.flatMap((row) => [`- type: ${row.type}`, `  source: ${row.source_path}`, `  accepted: ${row.accepted_path}`]),
  ].join("\n"));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
