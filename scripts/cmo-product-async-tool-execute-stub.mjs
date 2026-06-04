import http from "node:http";

const port = Number(process.env.STUB_PORT || 48765);
const delayMs = Number(process.env.STUB_DELAY_MS || 900);
const calls = [];

const responseFor = (requestBody) => ({
  schema_version: "hermes.cmo.response.v1",
  request_id: requestBody?.request_id || "stub-request",
  session_id: requestBody?.session_id || "stub-session",
  turn_id: requestBody?.turn_id || "stub-turn",
  status: "completed",
  answer_basis: {
    mode: "fully_grounded",
    missing_inputs: [],
    assumptions_used: [],
    user_can_override: true,
    suggested_user_inputs: [],
  },
  clarifying_question: {
    required: false,
    question: null,
    reason: null,
    missing_inputs: [],
  },
  answer: {
    format: "markdown",
    title: "Async tool orchestration smoke",
    summary: "Stub Hermes CMO completed the async tool run.",
    decision: "Render final CMO answer after polling.",
    body: "Final async CMO answer from stub Hermes tool-execute. No raw Surf/Echo JSON is exposed.",
  },
  structured_output: {
    recommendations: ["Poll the session until completed."],
    next_steps: ["Verify assistant message content updates from pending to final."],
  },
  delegations: [],
  artifacts: [],
  memory_suggestions: [],
  activity_summary: {
    events_count: 0,
    final_state: "completed",
  },
});

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "GET" && req.url === "/calls") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ calls }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/agents/cmo/tool-execute") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch {}
    calls.push({ url: req.url, method: req.method, receivedAt: new Date().toISOString(), request_id: body?.request_id, session_id: body?.session_id, user_message: body?.intent?.user_message });
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(responseFor(body)));
    }, delayMs);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ ok: true, stub: "cmo-tool-execute", port, delayMs }));
});
