import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanPendingGBrainCaptures } from "../src/lib/cmo/gbrain-pending-scanner.ts";
import { extractGBrainDryRun } from "../src/lib/cmo/gbrain-extractor.ts";
import { writeGBrainMemoryCandidates, GBRAIN_CANDIDATE_FOLDER } from "../src/lib/cmo/gbrain-candidate-writer.ts";

const vault = mkdtempSync(join(tmpdir(), "cmo-gbrain-write-"));
function writeCap(rel, fm, body) {
  const path = join(vault, rel);
  mkdirSync(path.split('/').slice(0,-1).join('/'), { recursive: true });
  writeFileSync(path, `---\ntitle: "${fm.title}"\ngbrain_status: pending\ncapture_origin: auto\nuser_id: "test-user"\nworkspace_id: "world-app-holdstation-mini-app"\nworkspace_group: "world_app"\nproject: "Holdstation Mini App"\nsource_agent: "${fm.agent}"\nmode: "${fm.mode}"\nskill: "${fm.skill}"\nsource_class: "${fm.sourceClass}"\nreview_status: "raw"\n---\n\n## Summary\n${body}\n`);
}
writeCap("07 Content Outputs/Echo/echo.md", { title:"Echo", agent:"Echo", mode:"content", skill:"echo", sourceClass:"execution_artifact" }, "Holdstation Mini App X post format using MiniKit.");
writeCap("05 Social Signals/Surf X/x.md", { title:"X", agent:"Surf", mode:"x_search", skill:"surf_x", sourceClass:"social_signal" }, "World App DeFi chatter mentions Morpho.");
writeCap("06 Trend Signals/Last30Days/trend.md", { title:"Trend", agent:"Surf", mode:"last30days", skill:"trend", sourceClass:"weak_trend_signal" }, "Worldchain and MiniKit weak trend observation.");
writeCap("08 Decisions/Draft Decisions/decision.md", { title:"Decision", agent:"CMO", mode:"strategy", skill:"cmo", sourceClass:"cmo_interpretation" }, "Decision candidate for Holdstation Wallet positioning.");
const rawBefore = readFileSync(join(vault, "07 Content Outputs/Echo/echo.md"), "utf8");
const captures = scanPendingGBrainCaptures({ vaultRoot: vault });
const results = captures.map(extractGBrainDryRun);
const dry = writeGBrainMemoryCandidates(results, { vaultRoot: vault, createdAt: "2026-05-26T00:00:00.000Z" });
assert.ok(dry.every((r) => r.status === "dry_run" || r.status === "skipped_guardrail"));
assert.ok(!readdirSync(vault, { recursive: true }).some((p) => String(p).startsWith(GBRAIN_CANDIDATE_FOLDER)));
const written = writeGBrainMemoryCandidates(results, { vaultRoot: vault, write: true, createdAt: "2026-05-26T00:00:00.000Z" });
assert.ok(written.some((r) => r.status === "written" && r.candidateType === "content_pattern"));
assert.ok(written.some((r) => r.status === "written" && r.candidateType === "positioning"));
assert.ok(written.some((r) => r.status === "written" && r.candidateType === "lesson"));
assert.ok(written.some((r) => r.status === "written" && r.candidateType === "decision"));
const dup = writeGBrainMemoryCandidates(results, { vaultRoot: vault, write: true, createdAt: "2026-05-26T00:00:00.000Z" });
assert.ok(dup.every((r) => r.status === "skipped_duplicate" || r.status === "skipped_guardrail"));
function walk(d) { let out=[]; for (const n of readdirSync(d)) { const p=join(d,n); const st=statSync(p); if (st.isDirectory()) out=out.concat(walk(p)); else out.push(p); } return out; }
const files = walk(join(vault, GBRAIN_CANDIDATE_FOLDER));
assert.ok(files.length >= 4);
for (const file of files) {
  const md = readFileSync(file, "utf8");
  assert.match(md, /review_status: review_candidate/); assert.match(md, /requires_review: true/);
  assert.match(md, /workspace_group: "world_app"/); assert.match(md, /project: "Holdstation Mini App"/);
  assert.doesNotMatch(md, /review_status: promoted|promoted: true/); assert.match(md, /Review Required/);
  assert.doesNotMatch(file, /content-output-pattern-candidate-from|candidate-candidate|agent-execution|social-theme-candidate/);
  assert.doesNotMatch(md.match(/## Proposed Memory\n([\s\S]*?)\n\n## Why This Was Extracted/)?.[1] ?? "", /^## Agent Execution/);
}
assert.ok(files.some((f) => /lesson/.test(f) && /weak-trend-observation/.test(f)), `missing clean weak trend filename in ${files.join("\n")}`);
assert.ok(files.some((f) => /skill: surf_x|skill: "surf_x"/.test(readFileSync(f, "utf8"))), `missing surf_x skill in ${files.map((f)=>readFileSync(f,"utf8").match(/skill:.*/)?.[0]).join(" | ")}`);
assert.ok(files.some((f) => /skill: trend|skill: "trend"/.test(readFileSync(f, "utf8"))), `missing trend skill in ${files.map((f)=>readFileSync(f,"utf8").match(/skill:.*/)?.[0]).join(" | ")}`);
assert.ok(files.every((f) => f.startsWith(join(vault, GBRAIN_CANDIDATE_FOLDER))), `outside candidate folder: ${files.join("\n")}`);
assert.equal(readFileSync(join(vault, "07 Content Outputs/Echo/echo.md"), "utf8"), rawBefore);
assert.ok(!readdirSync(vault, { recursive: true }).some((p) => String(p).includes("12 Knowledge/Compiled Truth")));
assert.ok(!JSON.stringify(readdirSync(vault, { recursive: true })).includes("App Memory"));
assert.ok(!readdirSync(vault, { recursive: true }).some((p) => String(p).includes("knowledge/holdstation")));
console.log(`GBrain candidate writer checks passed using temp vault: ${vault}`);
