import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = mkdtempSync(join(tmpdir(), "cmo-vault-save-mod-"));
const vault = mkdtempSync(join(tmpdir(), "cmo-engine-vault-test-"));
process.env.CMO_ENGINE_VAULT_PATH = vault;
try {
  for (const file of [
    "vault-capture-types.ts",
    "vault-capture-paths.ts",
    "vault-capture-redaction.ts",
    "vault-capture-renderer.ts",
    "vault-capture-preview.ts",
    "vault-capture-writer.ts",
  ]) cpSync(`src/lib/cmo/${file}`, join(temp, file));

  for (const file of ["vault-capture-paths.ts", "vault-capture-renderer.ts", "vault-capture-preview.ts", "vault-capture-writer.ts"]) {
    execFileSync("python3", ["-c", "from pathlib import Path; p=Path(__import__('sys').argv[1]); s=p.read_text(); s=s.replace('from \"./vault-capture-types\"','from \"./vault-capture-types.ts\"').replace('from \"./vault-capture-paths\"','from \"./vault-capture-paths.ts\"').replace('from \"./vault-capture-redaction\"','from \"./vault-capture-redaction.ts\"').replace('from \"./vault-capture-renderer\"','from \"./vault-capture-renderer.ts\"'); p.write_text(s)", join(temp, file)]);
  }

  const { buildCapturePreview } = await import(pathToFileURL(join(temp, "vault-capture-renderer.ts")));
  const { buildCapturePreviewEvent } = await import(pathToFileURL(join(temp, "vault-capture-preview.ts")));
  const { saveCaptureToCmoEngineVault, __vaultCaptureWriterTest } = await import(pathToFileURL(join(temp, "vault-capture-writer.ts")));
  const createdAt = "2026-05-25T16:45:00Z";

  const echoEvent = buildCapturePreviewEvent({ appId: "holdstation-mini-app", eventType: "echo_output", createdAt, content: "## Echo Output\n### Post 1\nFirst X post.\n\n### Post 2\nSecond X post.\nBearer abcdefghijklmnopqrstuvwxyz123456", confirmed: true });
  const preview = buildCapturePreview(echoEvent);
  assert.equal(preview.savedToVault, false);
  const saved = await saveCaptureToCmoEngineVault(echoEvent);
  assert.equal(saved.savedToVault, true);
  assert.match(saved.relativePath, /^07 Content Outputs\/Echo\//);
  assert.match(saved.relativePath, / - x - /);
  assert.ok(existsSync(saved.writtenPath));
  assert.doesNotMatch(readFileSync(saved.writtenPath, "utf8"), /abcdefghijklmnopqrstuvwxyz123456/);

  const second = await saveCaptureToCmoEngineVault(echoEvent);
  assert.match(second.relativePath, / - 02\.md$/);

  const surf = await saveCaptureToCmoEngineVault({ type: "surf_x_signal", createdAt, sourceAgent: "Surf", mode: "x_search", skill: "surf_x", sourceClass: "social_signal", summary: "X signal", topic: "Wallet chatter" });
  assert.match(surf.relativePath, /^05 Social Signals\/Surf X\//);

  const trend = await saveCaptureToCmoEngineVault({ type: "last30days_trend", createdAt, sourceAgent: "Surf", mode: "last30days", skill: "trend", sourceClass: "weak_trend_signal", summary: "Trend", topic: "Mini app growth" });
  assert.match(trend.relativePath, /^06 Trend Signals\/Last30Days\//);

  assert.throws(() => __vaultCaptureWriterTest.assertSafeTarget({ vaultId: "cmo-engine", vaultPath: vault, folder: "07 Content Outputs/Echo", filename: "bad.md", relativePath: "../bad.md", collisionPolicy: "append-counter" }, vault), /traversal|escapes/);
  const invalid = buildCapturePreview({ type: "surf_x_signal", createdAt, sourceAgent: "surf-x", mode: "x_search", skill: "surf_x", sourceClass: "social_signal", summary: "bad" });
  assert.equal(invalid.ok, false);

  const banned = new RegExp(`\\b(${["write" + "File", "append" + "File", "mkdir", "saveRaw" + "Capture"].join("|")})\\b`);
  for (const file of ["src/lib/cmo/vault-capture-types.ts", "src/lib/cmo/vault-capture-paths.ts", "src/lib/cmo/vault-capture-redaction.ts", "src/lib/cmo/vault-capture-renderer.ts", "src/lib/cmo/vault-capture-preview.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), banned);
  }

  assert.equal(existsSync("/home/ju/.openclaw/workspace/knowledge/holdstation"), true);
  console.log(`CMO vault save checks passed using temp vault: ${vault}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
  rmSync(vault, { recursive: true, force: true });
}
