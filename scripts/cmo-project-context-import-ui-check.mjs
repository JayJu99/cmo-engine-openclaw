import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const componentPath = "src/components/cmo-apps/project-context-import-card.tsx";
const workspaceViewPath = "src/components/cmo-apps/app-workspace-view.tsx";
const registryPath = "src/lib/cmo/workspace-registry.ts";

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

assert.equal(existsSync(join(root, componentPath)), true, "project context import card component must exist");

const componentSource = read(componentPath);
const workspaceViewSource = read(workspaceViewPath);
const registrySource = read(registryPath);

assert.match(workspaceViewSource, /ProjectContextImportCard/, "workspace Inputs tab must mount project context import card");
assert.match(componentSource, /type="file"/, "card must expose a file input");
assert.match(componentSource, /accept="\.md,text\/markdown,text\/plain"/, "card must accept markdown files");
assert.match(componentSource, /onDrop=/, "card must support dropping markdown files");
assert.match(componentSource, /\/api\/apps\/\$\{app\.id\}\/project-context\/import\/preview/, "card must call Product preview API route");
assert.match(componentSource, /\/api\/apps\/\$\{app\.id\}\/project-context\/import\/confirm/, "card must call Product confirm API route");
assert.match(componentSource, /Import as project context/, "card must render confirm button copy");
assert.match(componentSource, /detected\.doc_type/, "card must render detected doc types");
assert.match(componentSource, /detected\.source_path/, "card must render source path preview in admin card");
assert.match(componentSource, /detected\.accepted_path/, "card must render accepted path preview in admin card");
assert.match(componentSource, /previewReceipt\.conflicts\.length/, "card must surface conflicts");
assert.match(componentSource, /previewReceipt\.unmapped_files\.length/, "card must surface unmapped files");
assert.match(componentSource, /hasDetectedFiles/, "confirm guard must require detected files");
assert.match(componentSource, /hasBlockingConflict/, "confirm guard must block conflicts");
assert.match(componentSource, /hasPreviewErrors/, "confirm guard must block preview errors");
assert.match(componentSource, /overwrite_changed:\s*false/, "slice must default overwrite_changed=false");
assert.match(componentSource, /accepted_project_context:\s*mode === "confirm"/, "confirm payload must set accepted_project_context only on confirm");
assert.match(componentSource, /confirmed_by_user:\s*mode === "confirm"/, "confirm payload must set confirmed_by_user only on confirm");

assert.doesNotMatch(componentSource, /CMO_HERMES|HERMES_API|\/agents\/vault-agent/, "browser UI must not call Hermes directly");
assert.doesNotMatch(componentSource, /ingest-source|vault-auto-capture|write-turn-log|raw-activity-log/i, "browser UI must not call legacy capture or ingest paths");
assert.doesNotMatch(componentSource, /fs\/promises|writeFile|mkdir|appendFile|90 Runtime|runPromotion|from\s+["'].*(?:gbrain|supabase)|callGbrain|gbrainIndex/i, "browser UI must not write local Vault or couple to forbidden systems");
assert.doesNotMatch(componentSource, /Eggs Vault|eggs-vault|Holdstation Mini App|holdstation-mini-app/, "component must not hardcode workspace-specific import logic");

assert.match(registrySource, /workspaceId: "feeback"/, "Feeback workspace naming must remain intentional");
assert.match(registrySource, /aliases: \["feedback"\]/, "Feedback alias must remain intact");

console.log(JSON.stringify({
  ok: true,
  componentPath,
  previewApiUsed: true,
  confirmApiUsed: true,
  directHermesBrowserCall: false,
  localVaultWrite: false,
  markdownUpload: true,
  conflictGuard: true,
  feebackNamingUnchanged: true,
}, null, 2));
