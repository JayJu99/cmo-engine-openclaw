import assert from "assert/strict";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import vm from "vm";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const require = createRequire(import.meta.url);
const activityEventsSource = read("src/lib/cmo/activity-events.ts");

function loadActivityEventsModule() {
  const source = activityEventsSource;
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require,
    console,
  };

  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(output, sandbox, { filename: "activity-events.js" });

  return sandbox.module.exports;
}

const activity = loadActivityEventsModule();
const appStore = read("src/lib/cmo/app-chat-store.ts");
const activityPanel = read("src/components/cmo-apps/cmo-agent-activity-panel.tsx");

const checks = [];

function check(name, fn) {
  try {
    fn();
    checks.push(name);
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

check("legacy_alias_event_normalizes_to_v1", () => {
  const [event] = activity.normalizeCmoActivityEvents([
    {
      eventId: "legacy_evt_1",
      type: "delegation.started",
      status: "running",
      message: "Surf started",
      userVisible: true,
      sourceAgent: "surf",
      sourceMode: "surf.web",
    },
  ], {
    sessionId: "session_a",
    turnId: "turn_a",
    requestId: "request_a",
    createdAt: "2026-07-02T00:00:00.000Z",
  });

  assert.equal(event.schema_version, "cmo.activity.event.v1");
  assert.equal(event.event_id, "legacy_evt_1");
  assert.equal(event.source_agent, "surf");
  assert.equal(event.user_visible, true);
  assert.equal(event.safe_metadata.source_mode, "surf.web");
});

check("snake_case_hermes_events_preserve_seq_order", () => {
  const events = activity.normalizeCmoActivityEvents([
    {
      event_id: "evt_two",
      seq: 2,
      created_at: "2026-07-02T00:00:02.000Z",
      type: "cmo.run.completed",
      status: "completed",
      user_visible: true,
      source_agent: "cmo",
    },
    {
      event_id: "evt_one",
      seq: 1,
      created_at: "2026-07-02T00:00:01.000Z",
      type: "cmo.run.started",
      status: "running",
      user_visible: true,
      source_agent: "cmo",
    },
  ]);

  assert.deepEqual(events.map((event) => event.event_id), ["evt_two", "evt_one"]);
  assert.deepEqual(events.map((event) => event.seq), [2, 1]);
});

check("missing_seq_gets_stable_one_based_order", () => {
  const events = activity.normalizeCmoActivityEvents([
    { type: "cmo.step.one", status: "running", user_visible: true },
    { type: "cmo.step.two", status: "completed", user_visible: true },
  ], {
    sessionId: "session_b",
    turnId: "turn_b",
    createdAt: "2026-07-02T00:00:00.000Z",
  });

  assert.deepEqual(events.map((event) => event.seq), [1, 2]);
});

check("missing_event_id_gets_deterministic_fallback", () => {
  const [event] = activity.normalizeCmoActivityEvents([
    { type: "delegation.started", status: "running", user_visible: true, source_agent: "surf" },
  ], {
    sessionId: "session_c",
    turnId: "turn_c",
    createdAt: "2026-07-02T00:00:00.000Z",
  });

  assert.equal(event.event_id, "evt_session_c_turn_c_1_delegation.started_surf");
});

check("timed_out_cancelled_and_interrupted_statuses_are_supported", () => {
  const events = activity.normalizeCmoActivityEvents([
    { type: "product.chat_run.timed_out", status: "timed_out", user_visible: true, source_agent: "product" },
    { type: "product.chat_run.cancelled", status: "cancelled", user_visible: true, source_agent: "product" },
    { type: "product.chat_run.cancelled", status: "interrupted", user_visible: true, source_agent: "product" },
  ], {
    sessionId: "session_d",
    turnId: "turn_d",
    createdAt: "2026-07-02T00:00:00.000Z",
  });

  assert.deepEqual(events.map((event) => event.status), ["timed_out", "cancelled", "cancelled"]);
});

check("skipped_status_remains_skipped", () => {
  const events = activity.normalizeCmoActivityEvents([
    { type: "delegation.skipped", status: "skipped", user_visible: true, source_agent: "surf" },
    { type: "delegation.skipped", status: "skip", user_visible: true, source_agent: "echo" },
    { type: "delegation.skipped", status: "not_run", user_visible: true, source_agent: "lens" },
    { type: "cmo.run.completed", status: "succeeded", user_visible: true, source_agent: "cmo" },
  ], {
    sessionId: "session_skipped",
    turnId: "turn_skipped",
    createdAt: "2026-07-02T00:00:00.000Z",
  });

  assert.deepEqual(events.map((event) => event.status), ["skipped", "skipped", "skipped", "completed"]);
});

check("lens_creative_and_vault_agent_sources_are_supported", () => {
  const events = activity.normalizeCmoActivityEvents([
    { type: "lens.read", status: "completed", user_visible: true, source_agent: "lens" },
    { type: "creative.started", status: "running", user_visible: true, sourceAgent: "creative" },
    { type: "vault.lookup", status: "completed", user_visible: true, sourceAgent: "vault_agent" },
  ], {
    sessionId: "session_e",
    turnId: "turn_e",
    createdAt: "2026-07-02T00:00:00.000Z",
  });

  assert.deepEqual(events.map((event) => event.source_agent), ["lens", "creative", "vault"]);
});

check("safe_metadata_is_sanitized_and_bounded", () => {
  const [event] = activity.normalizeCmoActivityEvents([
    {
      type: "delegation.completed",
      status: "completed",
      user_visible: true,
      source_agent: "surf",
      safe_metadata: {
        delegation_id: "delegation_1",
        content: "must not persist",
        answer: "must not persist",
        authorization: "Bearer secret",
        file_path: "C:/secret.txt",
        safe_label: "x".repeat(500),
        count: 3,
        k01: "1",
        k02: "2",
        k03: "3",
        k04: "4",
        k05: "5",
        k06: "6",
        k07: "7",
        k08: "8",
        k09: "9",
        k10: "10",
        k11: "11",
        k12: "12",
        k13: "13",
        k14: "14",
        k15: "15",
        k16: "16",
        k17: "17",
        k18: "18",
        k19: "19",
        k20: "20",
        k21: "21",
      },
    },
  ], {
    sessionId: "session_f",
    turnId: "turn_f",
    createdAt: "2026-07-02T00:00:00.000Z",
  });

  const metadata = event.safe_metadata;

  assert.ok(metadata);
  assert.equal(metadata.content, undefined);
  assert.equal(metadata.answer, undefined);
  assert.equal(metadata.authorization, undefined);
  assert.equal(metadata.file_path, undefined);
  assert.equal(metadata.safe_label.length, 240);
  assert.ok(Object.keys(metadata).length <= 20);
  assert.ok(JSON.stringify(metadata).length <= 4000);
});

check("unsafe_activity_text_is_removed_before_persistence_or_render", () => {
  const [event] = activity.normalizeCmoActivityEvents([
    {
      event_id: "evt_unsafe_text",
      type: "delegation.completed",
      status: "failed",
      source_agent: "surf",
      user_visible: true,
      title: "Artifact at /Users/[redacted]/project/file.txt",
      message: "Safe failure summary.\nInternal detail: /home/[redacted]/tmp/artifact.json",
      safe_metadata: {
        diagnostic_note: "See /tmp/[redacted]/cmo-debug.log",
        nested: {
          detail: "file:/Users/[redacted]/something",
          safe_status: "failed",
        },
      },
    },
  ]);

  assert.equal(event.title, undefined);
  assert.equal(event.message, "Safe failure summary.");
  assert.equal(event.safe_metadata?.diagnostic_note, undefined);
  assert.equal(event.safe_metadata?.nested?.detail, undefined);
  assert.equal(event.safe_metadata?.nested?.safe_status, "failed");
  assert.doesNotMatch(JSON.stringify(event), /file:|\/(?:tmp|Users|home)\//i);
});

check("product_lifecycle_events_apply_the_same_text_boundary", () => {
  const event = activity.createProductChatRunLifecycleEvent({
    status: "timed_out",
    title: "Timed out at C:\\Users\\[redacted]\\artifact.json",
    message: "Timed out safely.\nRaw trace: file:/Users/[redacted]/trace.log",
    safeMetadata: {
      diagnostic_note: "Bearer abcdefghijklmnopqrstuvwxyz123456",
      timeout_ms: 30_000,
    },
  });

  assert.equal(event.status, "timed_out");
  assert.equal(event.title, undefined);
  assert.equal(event.message, "Timed out safely.");
  assert.equal(event.safe_metadata?.diagnostic_note, undefined);
  assert.equal(event.safe_metadata?.timeout_ms, 30_000);
  assert.doesNotMatch(JSON.stringify(event), /file:|[A-Za-z]:[\\/]|Bearer\s+[A-Za-z0-9._-]{20,}/i);
});

check("session_and_message_persistence_use_canonical_events", () => {
  assert.match(appStore, /activityEvents:\s*queuedActivityEvents/);
  assert.match(appStore, /schema_version/);
  assert.match(appStore, /createdAt:\s*now/);
  assert.match(appStore, /activityEvents:\s*completedActivityEvents/);
  assert.match(appStore, /activityEvents:\s*failureActivityEvents/);
  assert.match(appStore, /activityEvents:\s*cancelledActivityEvents/);
});

check("activity_panel_reads_old_and_new_event_shapes", () => {
  assert.match(activityPanel, /cmoActivityEventUserVisible/);
  assert.match(activityPanel, /cmoActivityEventSourceAgent/);
  assert.match(activityPanel, /cmoActivityEventId/);
  assert.match(activityEventsSource, /event_id\s*\?\?\s*value\.eventId/);
  assert.match(activityEventsSource, /user_visible[\s\S]*userVisible/);
});

check("activity_panel_avoids_duplicate_delegation_summary_rows", () => {
  assert.match(activityPanel, /representedDelegationKeys/);
  assert.match(activityPanel, /cmoActivityEventDelegationId/);
  assert.match(activityPanel, /representedDelegations\.ids\.has/);
  assert.match(activityPanel, /representedDelegations\.matches\.has/);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`cmo-chat-activity-event-contract-check: ${checks.length} checks passed`);
