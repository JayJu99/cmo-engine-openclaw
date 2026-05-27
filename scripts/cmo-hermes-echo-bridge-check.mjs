import assert from "node:assert/strict";

process.env.CMO_HERMES_EXECUTION_ENABLED = "true";
process.env.CMO_HERMES_BASE_URL = "https://hermes.example.test";
process.env.CMO_HERMES_API_KEY = "test-key-not-secret";

const { maybeHandleEchoBridge } = await import("../src/lib/cmo/echo-bridge.ts");
const { cleanFallbackAnswerFormatting } = await import("../src/lib/cmo/runtime.ts");

let capturedUrl = "";
let capturedPayload;

globalThis.fetch = async (url, init) => {
  capturedUrl = String(url);
  assert.equal(capturedUrl, "https://hermes.example.test/agents/echo/execute");
  assert.equal(init?.method, "POST");
  assert.equal(init?.headers?.authorization, "Bearer test-key-not-secret");
  capturedPayload = JSON.parse(String(init?.body));

  return new Response(
    JSON.stringify({
      error: "Echo worker unavailable",
      code: "echo_upstream_502",
    }),
    {
      status: 502,
      headers: {
        "content-type": "application/json",
      },
    },
  );
};

const result = await maybeHandleEchoBridge({
  workspaceId: "holdstation",
  appId: "holdstation-mini-app",
  appName: "Holdstation Mini App",
  message: "/echo Write 1 short X post about Holdstation Mini App activation.",
  context: {
    selectedNotes: [],
    mode: "app_context",
  },
});

assert.equal(result.handled, true);
assert.equal(capturedPayload.target_agent, "echo");
assert.equal(capturedPayload.source_agent, "jay");
assert.equal(capturedPayload.mode, "direct_jay");
assert.equal(capturedPayload.workspace, "holdstation-mini-app");
assert.equal(capturedPayload.source_context.origin, "cmo_engine_direct_echo_command");
assert.match(result.response?.answer ?? "", /Hermes Echo returned HTTP 502/);
assert.match(result.response?.answer ?? "", /Upstream gateway\/runtime error/);
assert.match(result.response?.answer ?? "", /Echo worker unavailable/);
assert.match(result.response?.answer ?? "", /No Echo output was produced/);

const cleaned = cleanFallbackAnswerFormatting("## Context Used Contex\n\nContext used: App Memory.\n\n\n## Runtime Note\n\nFallback.");
assert.equal(cleaned.includes("Context Used Contex"), false);
assert.match(cleaned, /^## Context Used/m);

console.log("CMO Hermes Echo bridge checks passed");
