import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanPendingGBrainCaptures } from "../src/lib/cmo/gbrain-pending-scanner.ts";
import { extractGBrainDryRun } from "../src/lib/cmo/gbrain-extractor.ts";

const vault = mkdtempSync(join(tmpdir(), "cmo-gbrain-dry-"));
function writeCap(rel, fm, body) {
  const path = join(vault, rel); mkdirSync(path.split('/').slice(0,-1).join('/'), { recursive: true });
  writeFileSync(path, `---\ntitle: "${fm.title}"\ngbrain_status: pending\ncapture_origin: auto\nworkspace_id: "world-app-holdstation-mini-app"\nsource_agent: "${fm.agent}"\nmode: "${fm.mode}"\nskill: "${fm.skill}"\nsource_class: "${fm.sourceClass}"\nreview_status: "raw"\n---\n\n## Summary\n${body}\n`);
}
writeCap("07 Content Outputs/Echo/echo.md", { title:"Echo", agent:"Echo", mode:"content", skill:"echo", sourceClass:"execution_artifact" }, "Holdstation Mini App X post format using MiniKit. echo-final-003");
writeCap("05 Social Signals/Surf X/x.md", { title:"X", agent:"Surf", mode:"x_search", skill:"surf_x", sourceClass:"social_signal" }, "World App DeFi chatter mentions Morpho.");
writeCap("06 Trend Signals/Last30Days/trend.md", { title:"Trend", agent:"Surf", mode:"last30days", skill:"trend", sourceClass:"weak_trend_signal" }, "Worldchain and MiniKit weak trend observation.");
writeCap("08 Decisions/Draft Decisions/decision.md", { title:"Decision", agent:"CMO", mode:"strategy", skill:"cmo", sourceClass:"cmo_interpretation" }, "Decision candidate for Holdstation Wallet positioning.");
writeCap("07 Content Outputs/Echo/manual.md", { title:"Manual", agent:"Echo", mode:"content", skill:"echo", sourceClass:"execution_artifact" }, "manual");
writeFileSync(join(vault, "07 Content Outputs/Echo/manual.md"), `---\ngbrain_status: pending\ncapture_origin: manual\n---\nmanual`);
const before = JSON.stringify(readdirSync(vault, { recursive: true }).sort());
const captures = scanPendingGBrainCaptures({ vaultRoot: vault });
assert.equal(captures.length, 4);
const results = captures.map(extractGBrainDryRun);
const echo = results.find((r) => r.sourceClass === "execution_artifact");
assert.ok(echo.memoryCandidates.some((c) => c.candidate_type === "content_pattern"));
assert.ok(!echo.memoryCandidates.some((c) => /fact/i.test(c.proposed_text)));
assert.ok(results.find((r) => r.sourceClass === "social_signal").warnings.some((w) => /not verified fact/i.test(w)));
assert.ok(results.find((r) => r.sourceClass === "weak_trend_signal").warnings.some((w) => /weak trend|weak signal/i.test(w)));
assert.ok(results.every((r) => r.recommendedNextAction === "dry_run_review_only"));
assert.ok(results.every((r) => r.memoryCandidates.every((c) => c.requires_review === true)));
assert.equal(JSON.stringify(readdirSync(vault, { recursive: true }).sort()), before);
assert.ok(!JSON.stringify(results).includes("Compiled Truth"));
console.log(`GBrain dry-run checks passed using temp vault: ${vault}`);
