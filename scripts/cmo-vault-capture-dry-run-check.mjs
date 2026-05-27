import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const temp = mkdtempSync(join(tmpdir(), "cmo-vault-capture-"));
try {
  for (const file of [
    "vault-capture-types.ts",
    "vault-capture-paths.ts",
    "vault-capture-redaction.ts",
    "vault-capture-renderer.ts",
  ]) {
    cpSync(`src/lib/cmo/${file}`, join(temp, file));
  }

  for (const file of ["vault-capture-paths.ts", "vault-capture-renderer.ts"]) {
    execFileSync("python3", [
      "-c",
      "from pathlib import Path; p=Path(__import__('sys').argv[1]); s=p.read_text(); s=s.replace('from \"./vault-capture-types\"','from \"./vault-capture-types.ts\"').replace('from \"./vault-capture-paths\"','from \"./vault-capture-paths.ts\"').replace('from \"./vault-capture-redaction\"','from \"./vault-capture-redaction.ts\"'); p.write_text(s)",
      join(temp, file),
    ]);
  }

  const { buildCapturePreview } = await import(pathToFileURL(join(temp, "vault-capture-renderer.ts")));
  const createdAt = "2026-05-25T07:45:00Z";
  const base = (overrides) => ({
    type: "cmo_session",
    createdAt,
    sourceAgent: "CMO",
    sourceClass: "operational_event",
    summary: "CMO session summary",
    topic: "Capture Test",
    ...overrides,
  });

  const echo = buildCapturePreview(base({ type: "echo_output", sourceAgent: "Echo", sourceClass: "execution_artifact", platform: "Facebook", topic: "Launch Copy", summary: "Echo wrote copy." }));
  assert.equal(echo.ok, true);
  assert.equal(echo.savedToVault, false);
  assert.equal(echo.target.relativePath, "07 Content Outputs/Echo/2026-05-25 - facebook - launch-copy.md");
  assert.match(echo.markdown, /source_class: "execution_artifact"/);
  assert.match(echo.markdown, /Generated output is not strategy\/research\/published content unless separately reviewed\./);

  const surfX = buildCapturePreview(base({ type: "surf_x_signal", sourceAgent: "Surf", mode: "x_search", skill: "surf_x", sourceClass: "social_signal", topic: "Wallet chatter", summary: "X chatter increased." }));
  assert.equal(surfX.ok, true);
  assert.equal(surfX.savedToVault, false);
  assert.equal(surfX.target.relativePath, "05 Social Signals/Surf X/2026-05-25 - wallet-chatter - X Signal.md");
  assert.match(surfX.markdown, /X\/social signal is not verified fact\./);

  const trend = buildCapturePreview(base({ type: "last30days_trend", sourceAgent: "Surf", mode: "last30days", skill: "trend", sourceClass: "weak_trend_signal", topic: "Mini app growth", summary: "Recent trend scan." }));
  assert.equal(trend.ok, true);
  assert.equal(trend.savedToVault, false);
  assert.equal(trend.target.relativePath, "06 Trend Signals/Last30Days/2026-05-25 - mini-app-growth - Trend.md");
  assert.match(trend.markdown, /Last30Days\/trend signal is weak signal, not verified fact\./);

  const decision = buildCapturePreview(base({ type: "cmo_decision", sourceAgent: "CMO", sourceClass: "cmo_interpretation", topic: "Scale campaign", summary: "CMO recommends SCALE." }));
  assert.equal(decision.ok, true);
  assert.equal(decision.savedToVault, false);
  assert.equal(decision.target.relativePath, "08 Decisions/Draft Decisions/2026-05-25 - scale-campaign.md");
  assert.match(decision.markdown, /review_status: "review_candidate"/);

  const invalid = buildCapturePreview({ type: "surf_x_signal", createdAt, sourceAgent: "surf-x", mode: "x_search", skill: "surf_x", sourceClass: "social_signal", summary: "bad taxonomy" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Only CMO, Echo, and Surf are agents/);

  const redacted = buildCapturePreview(base({ type: "ops_event", sourceAgent: "CMO", sourceClass: "operational_event", topic: "Token check", summary: "Bearer abcdefghijklmnopqrstuvwxyz123456 should be hidden.", payloadSummary: "authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890\napi_key=sk_1234567890abcdefghijklmnopqrstuvwxyz" }));
  assert.equal(redacted.ok, true);
  assert.doesNotMatch(redacted.markdown, /abcdefghijklmnopqrstuvwxyz1234567890/);
  assert.match(redacted.markdown, /\[REDACTED/);

  const banned = new RegExp(`\\b(${["write" + "File", "append" + "File", "mkdir", "saveRaw" + "Capture"].join("|")})\\b`);
  for (const file of [
    "src/lib/cmo/vault-capture-types.ts",
    "src/lib/cmo/vault-capture-paths.ts",
    "src/lib/cmo/vault-capture-redaction.ts",
    "src/lib/cmo/vault-capture-renderer.ts",
    "src/lib/cmo/vault-capture-preview.ts",
  ]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), banned);
  }

  console.log("No vault write helpers found in capture modules");
  console.log("CMO vault capture dry-run checks passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
