import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "cmo-project-context-ingest-"));
const vault = join(temp, "vault");

function write(path, content) {
  const target = join(temp, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  return target;
}

function run(args, options = {}) {
  return execFileSync(process.execPath, [join(root, "scripts/cmo-project-context-ingest.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

try {
  const audience = write("docs/audienceEV.md", "EGGS_AUDIENCE_SENTINEL from source doc");
  const positioning = write("docs/positioningEV.md", "EGGS_POSITIONING_SENTINEL from source doc");
  const productTruth = write("docs/product-truthEV.md", "EGGS_PRODUCT_TRUTH_SENTINEL from source doc");
  const campaignRules = write("docs/eggs-vault-campaign-rules.md", "EGGS_CAMPAIGN_RULE_SENTINEL from source doc");
  const contentPillars = write("docs/eggs-vault-content-pillars.md", "EGGS_CONTENT_PILLAR_SENTINEL from source doc");

  const commonArgs = [
    "--workspace-id", "eggs-vault",
    "--project-name", "Eggs Vault",
    "--vault-root", vault,
    "--audience", audience,
    "--positioning", positioning,
    "--product-truth", productTruth,
    "--campaign-rules", campaignRules,
    "--content-pillars", contentPillars,
  ];

  const dryRun = run(commonArgs);
  assert.match(dryRun, /dry_run: true|"dry_run"\s*:\s*true/, "default must be dry-run");
  assert.match(dryRun, /13 Sources\/Source Notes\/eggs-vault\/project-context\/audience\.md/);
  assert.match(dryRun, /12 Knowledge\/Workspace Lessons\/eggs-vault\/project-audience\.md/);
  assert.equal(existsSync(join(vault, "13 Sources")), false, "dry-run must not create source files");
  assert.equal(existsSync(join(vault, "12 Knowledge")), false, "dry-run must not create accepted files");

  const writeOut = run([...commonArgs, "--write"]);
  assert.match(writeOut, /dry_run: false|"dry_run"\s*:\s*false/);
  assert.match(writeOut, /write_performed: true|"write_performed"\s*:\s*true/);

  const sourceAudience = readFileSync(join(vault, "13 Sources/Source Notes/eggs-vault/project-context/audience.md"), "utf8");
  const acceptedAudience = readFileSync(join(vault, "12 Knowledge/Workspace Lessons/eggs-vault/project-audience.md"), "utf8");
  const acceptedCampaign = readFileSync(join(vault, "12 Knowledge/Workspace Lessons/eggs-vault/project-campaign-rules.md"), "utf8");

  assert.match(sourceAudience, /record_type: source_note/);
  assert.match(sourceAudience, /workspace_id: eggs-vault/);
  assert.match(sourceAudience, /source_type: project_context/);
  assert.match(acceptedAudience, /record_type: workspace_knowledge/);
  assert.match(acceptedAudience, /workspace_id: eggs-vault/);
  assert.match(acceptedAudience, /truth_status: accepted/);
  assert.match(acceptedAudience, /review_status: accepted/);
  assert.match(acceptedAudience, /visibility: workspace/);
  assert.match(acceptedAudience, /source_type: project_context/);
  assert.match(acceptedAudience, /source_note_path: 13 Sources\/Source Notes\/eggs-vault\/project-context\/audience\.md/);
  assert.match(acceptedAudience, /EGGS_AUDIENCE_SENTINEL/);
  assert.match(acceptedCampaign, /EGGS_CAMPAIGN_RULE_SENTINEL/);

  const scriptSource = readFileSync(join(root, "scripts/cmo-project-context-ingest.mjs"), "utf8");
  assert.doesNotMatch(scriptSource, /gbrain|supabase|90 Runtime|promotion/i, "ingest script must not couple to GBrain/Supabase/promotion/runtime indexing");

  console.log("CMO project context ingest checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
