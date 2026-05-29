import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "cmo-vault-agent-dry-run-"));
const dist = join(temp, "dist");
const requireFromScript = createRequire(import.meta.url);
const tscBin = join("node_modules", "typescript", "bin", "tsc");

try {
  for (const file of [
    "vault-agent-contracts.ts",
    "vault-scope-policy.ts",
    "vault-agent-dry-run.ts",
  ]) {
    cpSync(`src/lib/cmo/${file}`, join(temp, file));
  }

  execFileSync(process.execPath, [
    tscBin,
    "--target",
    "ES2022",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--esModuleInterop",
    "--skipLibCheck",
    "--strict",
    "--outDir",
    dist,
    join(temp, "vault-agent-contracts.ts"),
    join(temp, "vault-scope-policy.ts"),
    join(temp, "vault-agent-dry-run.ts"),
  ], { stdio: "inherit" });

  const {
    buildCanonicalPath,
    buildMarkdownPreview,
    buildSourceMapPath,
    buildVaultAgentDryRunReceipt,
    normalizeVaultRecord,
  } = requireFromScript(join(dist, "vault-agent-dry-run.js"));
  const {
    decideIndexability,
    decidePromotionEligibility,
    validateVaultRecord,
  } = requireFromScript(join(dist, "vault-scope-policy.js"));

  const base = {
    tenant_id: "holdstation",
    workspace_id: "holdstation-mini-app",
    user_id: "user_123",
    session_id: "session_123",
    message_id: "msg_123",
    source_agent: "CMO",
    created_at: "2026-05-29T00:00:00.000Z",
    original_language: "vi",
    original_text: "Nguon goc tieng Viet duoc giu lai.",
    canonical_summary: "Canonical English summary for review.",
  };

  const privateAccepted = normalizeVaultRecord({
    ...base,
    record_type: "turn_log",
    scope: "session",
    visibility: "private",
    truth_status: "accepted",
    review_status: "approved",
  });
  assert.equal(validateVaultRecord(privateAccepted).valid, false);
  assert.match(validateVaultRecord(privateAccepted).errors.join("\n"), /cannot become accepted knowledge directly/);

  const emailLike = normalizeVaultRecord({
    ...base,
    user_id: undefined,
    user_ref: "jay@example.com",
    record_type: "source_note",
    redaction_applied: true,
  });
  assert.equal(decideIndexability(emailLike).gbrain_index, false);
  assert.equal(decideIndexability(emailLike).gbrain_status, "not_indexable");

  const sourceAsset = normalizeVaultRecord({
    ...base,
    record_type: "source_asset",
    source_asset_id: "asset_001",
    safe_original_name: "source-image.png",
  });
  assert.equal(decideIndexability(sourceAsset).gbrain_index, false);
  assert.equal(decideIndexability(sourceAsset).gbrain_status, "not_indexable");

  const sourceNoteInput = {
    ...base,
    record_type: "source_note",
    title: "Source Note",
    source_note_id: "note_001",
    redaction_applied: true,
    pii_policy: "redacted",
    visibility: "workspace",
    scope: "workspace",
  };
  const sourceNote = normalizeVaultRecord(sourceNoteInput);
  assert.equal(validateVaultRecord(sourceNote).valid, true);
  assert.equal(decideIndexability(sourceNote).gbrain_index, true);
  assert.equal(decideIndexability(sourceNote).gbrain_status, "pending_index");

  const workspaceCandidate = normalizeVaultRecord({
    ...base,
    record_type: "workspace_candidate",
    scope: "workspace",
    visibility: "workspace",
  });
  const candidatePromotion = decidePromotionEligibility(workspaceCandidate);
  assert.equal(candidatePromotion.eligible, false);
  assert.ok(candidatePromotion.blocked_by.includes("candidate_record_requires_review_gate"));

  const acceptedKnowledgeWithoutRefs = normalizeVaultRecord({
    ...base,
    record_type: "workspace_knowledge",
    scope: "workspace",
    visibility: "workspace",
    truth_status: "accepted",
    review_status: "approved",
  });
  assert.equal(validateVaultRecord(acceptedKnowledgeWithoutRefs).valid, false);
  assert.match(validateVaultRecord(acceptedKnowledgeWithoutRefs).errors.join("\n"), /require safe provenance/);

  const uncitedWiki = normalizeVaultRecord({
    ...base,
    record_type: "wiki_page",
    scope: "workspace",
    visibility: "workspace",
    truth_status: "accepted",
    review_status: "approved",
    source_refs: ["source_1"],
    accepted_claims: ["Activation proof is the current priority."],
    cited_claims: [],
  });
  assert.equal(validateVaultRecord(uncitedWiki).valid, false);
  assert.match(validateVaultRecord(uncitedWiki).errors.join("\n"), /uncited accepted claims/);

  const missingTenant = normalizeVaultRecord({
    ...base,
    tenant_id: "",
    record_type: "source_note",
    redaction_applied: true,
  });
  assert.equal(validateVaultRecord(missingTenant).valid, false);
  assert.match(decideIndexability(missingTenant).reason, /tenant/);
  assert.equal(decideIndexability(sourceNote).required_filters.tenant_id, "holdstation");
  assert.equal(decideIndexability(sourceNote).required_filters.workspace_id, "holdstation-mini-app");

  assert.equal(
    buildCanonicalPath(sourceAsset),
    "13 Sources/Assets/holdstation-mini-app/2026/05/asset-001 - source-image.png",
  );
  assert.equal(
    buildCanonicalPath(sourceNote),
    "13 Sources/Source Notes/holdstation-mini-app/2026/05/note-001 - source-note.md",
  );
  assert.equal(
    buildCanonicalPath(normalizeVaultRecord({ ...base, record_type: "visual_analysis", source_note_id: "note_002", title: "Chart Review" })),
    "13 Sources/Visual Analysis/holdstation-mini-app/2026/05/note-002 - chart-review.md",
  );
  assert.equal(
    buildCanonicalPath(normalizeVaultRecord({ ...base, record_type: "table_data_summary", source_note_id: "note_003", title: "Metrics Table" })),
    "13 Sources/Tables & Data/holdstation-mini-app/2026/05/note-003 - metrics-table.md",
  );
  assert.equal(buildSourceMapPath("holdstation-mini-app"), "13 Sources/Source Maps/holdstation-mini-app.md");

  const stableA = normalizeVaultRecord({ ...base, record_type: "turn_log" });
  const stableB = normalizeVaultRecord({ ...base, record_type: "turn_log", title: "Different title" });
  assert.equal(stableA.frontmatter.record_id, stableB.frontmatter.record_id);

  const markdown = buildMarkdownPreview(sourceNote);
  assert.match(markdown, /## Original \/ Raw/);
  assert.match(markdown, /## Canonical English Summary/);
  assert.match(markdown, /## Links/);
  assert.match(markdown, /\[\[holdstation-mini-app\]\]/);
  assert.match(markdown, /canonical_language: "en"/);

  const receipt = buildVaultAgentDryRunReceipt(sourceNoteInput);
  assert.equal(receipt.write_confirmed, false);
  assert.equal(receipt.no_filesystem_write, true);
  assert.equal(receipt.no_gbrain_call, true);
  assert.equal(receipt.status, "dry_run");
  assert.match(receipt.target_path_preview, /^13 Sources\/Source Notes\//);

  const banned = /\b(writeFile|appendFile|mkdir|rm|cpSync|createWriteStream|saveCaptureToCmoEngineVault|writeGBrain|scanPendingGBrain|extractGBrain)\b/;
  for (const file of [
    "src/lib/cmo/vault-agent-contracts.ts",
    "src/lib/cmo/vault-scope-policy.ts",
    "src/lib/cmo/vault-agent-dry-run.ts",
  ]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), banned);
  }

  console.log("CMO Vault Agent dry-run contract checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
