import { extractGBrainDryRun } from "../src/lib/cmo/gbrain-extractor.ts";
import { scanPendingGBrainCaptures } from "../src/lib/cmo/gbrain-pending-scanner.ts";
import { writeGBrainMemoryCandidates } from "../src/lib/cmo/gbrain-candidate-writer.ts";
import { indexGBrainCandidate } from "../src/lib/cmo/supabase-indexing.ts";

const args = process.argv.slice(2);
const scan = {}; const writeOpt = { write: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--write") writeOpt.write = true;
  else if (args[i] === "--limit") scan.limit = Number(args[++i]);
  else if (args[i] === "--workspace") scan.workspaceId = args[++i];
  else if (args[i] === "--source-class") scan.sourceClass = args[++i];
  else if (args[i] === "--vault") { scan.vaultRoot = args[++i]; writeOpt.vaultRoot = scan.vaultRoot; }
}
const captures = scanPendingGBrainCaptures(scan);
const extractions = captures.map(extractGBrainDryRun);
const results = writeGBrainMemoryCandidates(extractions, writeOpt);
if (writeOpt.write) {
  const written = results.filter((result) => result.status === "written");
  const indexResults = [];
  for (const candidate of written) {
    indexResults.push(await indexGBrainCandidate({ candidate }));
  }
  const indexed = indexResults.filter((result) => result.status === "indexed").length;
  const skipped = indexResults.filter((result) => result.status === "skipped").length;
  const failed = indexResults.filter((result) => result.status === "failed").length;
  console.log(`Supabase candidate indexing: ${indexed} indexed, ${skipped} skipped, ${failed} failed.`);
}
console.log(`GBrain candidate writer ${writeOpt.write ? "WRITE" : "DRY-RUN"}: ${results.length} candidate action(s) from ${captures.length} capture(s)`);
const counts = results.reduce((acc, r) => (acc[r.status] = (acc[r.status] || 0) + 1, acc), {});
console.log(JSON.stringify(counts, null, 2));
for (const r of results.slice(0, 10)) console.log(`${r.status} | ${r.candidateType} | ${r.relativePath ?? ""} | ${r.reason ?? r.proposedText.slice(0, 120)}`);
console.log(writeOpt.write ? "WROTE proposal notes only under 09 Proposals/Memory Candidates." : "DRY RUN ONLY: pass --write to create proposal notes.");
