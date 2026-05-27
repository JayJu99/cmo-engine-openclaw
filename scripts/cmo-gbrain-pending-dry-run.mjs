import { extractGBrainDryRun } from "../src/lib/cmo/gbrain-extractor.ts";
import { renderGBrainPreview, renderGBrainSummaryTable } from "../src/lib/cmo/gbrain-renderer.ts";
import { scanPendingGBrainCaptures } from "../src/lib/cmo/gbrain-pending-scanner.ts";

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--limit") opt.limit = Number(args[++i]);
  else if (args[i] === "--workspace") opt.workspaceId = args[++i];
  else if (args[i] === "--source-class") opt.sourceClass = args[++i];
  else if (args[i] === "--vault") opt.vaultRoot = args[++i];
}
const captures = scanPendingGBrainCaptures(opt);
const results = captures.map(extractGBrainDryRun);
console.log(`GBrain pending raw dry-run: ${results.length} capture(s)`);
console.log(renderGBrainSummaryTable(results));
console.log(renderGBrainPreview(results, Math.min(opt.limit ?? 5, 5)));
console.log("\nDRY RUN ONLY: no raw capture mutations, no Compiled Truth writes, no App Memory updates, no promotions.");
