import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const chatPanel = read("src/components/cmo-apps/cmo-chat-panel.tsx");
const activityPanel = read("src/components/cmo-apps/cmo-agent-activity-panel.tsx");
const evidenceDisplay = read("src/lib/cmo/cmo-chat-evidence-display.ts");
const appStore = read("src/lib/cmo/app-chat-store.ts");
const hermesFirst = read("src/lib/cmo/hermes-first-cmo-chat.ts");

const checks = [];

function check(name, condition, detail = "") {
  if (!condition) {
    console.error(`not ok ${name}${detail ? ` - ${detail}` : ""}`);
    process.exitCode = 1;
    return;
  }

  checks.push(name);
  console.log(`ok ${name}`);
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : "";
}

const approvalRenderer = section(chatPanel, "function renderApprovalRequests", "function renderSuggestedVaultUpdates");
const activityRows = section(activityPanel, "function activityRows", "function statusVariant");

check("activity_panel_uses_hermes_activity_events_for_hermes_first_messages", activityRows.includes("hermesFirstMessage") && activityRows.includes("message?.activityEvents ?? message?.hermesCmoMetadata?.activityEvents"));
check("activity_panel_preserves_event_order", activityRows.includes("events.filter") && activityRows.includes("events.find") && !activityRows.includes(".sort("));
check("artifact_panel_renders_artifacts_out", chatPanel.includes("message.sessionArtifacts") && hermesFirst.includes("sessionArtifacts: input.response.artifacts_out"));
check("approval_panel_renders_approval_requests_without_execution", approvalRenderer.includes("message.approvalRequests") && approvalRenderer.includes("Approval Requests") && !approvalRenderer.includes("onClick="));
check("activity_panel_labels_lens_and_vault_agent_provenance", activityPanel.includes('agent === "lens"') && activityPanel.includes('agent === "vault_agent"'));
check("suggested_vault_updates_remain_draft_until_review", appStore.includes("truth_status: \"draft\"") && appStore.includes("vault_write_performed: false") && appStore.includes("requires_user_or_product_approval: true"));
check("warnings_errors_render_as_status_ui_not_answer_rewrite", hermesFirst.includes("contract_warnings") && hermesFirst.includes("errors: input.response.errors") && !hermesFirst.includes("warnings.join"));
check("evidence_display_remains_non_mutating", evidenceDisplay.includes("buildCmoEvidenceSources") && !evidenceDisplay.includes("writeFile("));
check("chat_panel_receives_boundary_render_source", appStore.includes("hermes_cmo_boundary_failure") && activityPanel.includes("hermes_cmo_boundary_failure"));

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`cmo-hermes-first-ui-contract-check: ${checks.length} checks passed`);
