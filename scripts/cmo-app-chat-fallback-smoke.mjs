const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
const expectedReason = process.env.CMO_SMOKE_EXPECT_REASON || "unsupported_chat_turn";
const allowedReasons = new Set(["unsupported_chat_turn", "timeout", "invalid_response", "empty_answer", "execution_error"]);
const endpoint = `${baseUrl}/api/cmo/chat`;

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    process.exit(1);
  }
}

function containsRecommendation(answer) {
  return /Action\s+1:/i.test(answer) || /recommended|recommendation|focus this/i.test(answer);
}

function containsContextUsed(answer) {
  return /Context used:/i.test(answer);
}

function authorizationHeader() {
  const explicit = process.env.CMO_SMOKE_AUTH_HEADER?.trim();

  if (explicit) {
    return explicit;
  }

  const username = process.env.BASIC_AUTH_USERNAME;
  const password = process.env.BASIC_AUTH_PASSWORD;

  if (username && password) {
    return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  return "";
}

function responseDiagnostics(response, contentType, rawBody) {
  return {
    url: endpoint,
    status: response.status,
    statusText: response.statusText,
    contentType: contentType || "not provided",
    rawBody: rawBody.slice(0, 1000),
  };
}

const payload = {
  workspaceId: "holdstation",
  appId: "holdstation-mini-app",
  appName: "Holdstation Mini App",
  message:
    "Based on the current priority and App Memory, give me 3 recommended CMO actions for Holdstation Mini App this week. Also state which context you used.",
  topic: "Phase 1.86B fallback smoke",
  context: {
    selectedNotes: [],
    mode: "app_context",
  },
};
const auth = authorizationHeader();
const headers = {
  "Content-Type": "application/json",
  ...(auth ? { Authorization: auth } : {}),
};

const response = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});
const contentType = response.headers.get("content-type") || "";
const rawBody = await response.text();
const data = contentType.toLowerCase().includes("json")
  ? (() => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return null;
      }
    })()
  : null;
const diagnostics = responseDiagnostics(response, contentType, rawBody);

assert(response.ok, `Expected HTTP 2xx from ${endpoint}`, diagnostics);
assert(data && typeof data === "object", "Expected JSON response body", diagnostics);
assert(data.status === "completed", "Expected completed session status", data);
assert(data.runtimeStatus === "live_failed_then_fallback", "Expected live runtime attempt to fall back", data);
assert(data.attemptedRuntimeMode === "live", "Expected attemptedRuntimeMode=live", data);
assert(data.runtimeMode === "fallback", "Expected runtimeMode=fallback", data);
assert(data.isRuntimeFallback === true, "Expected isRuntimeFallback=true", data);
assert(allowedReasons.has(data.runtimeErrorReason), "Expected a controlled runtimeErrorReason", data);

if (expectedReason !== "any") {
  assert(data.runtimeErrorReason === expectedReason, `Expected runtimeErrorReason=${expectedReason}`, data);
}

assert(typeof data.answer === "string" && data.answer.trim().length > 120, "Expected a useful fallback answer", data);
assert(!data.answer.trim().startsWith("Fallback response:"), "Expected answer to be more than diagnostics", data.answer);
assert(containsRecommendation(data.answer), "Expected at least one recommendation in answer", data.answer);
assert(containsContextUsed(data.answer), "Expected answer to include context used", data.answer);

console.log(
  JSON.stringify(
    {
      ok: true,
      sessionId: data.sessionId,
      runtimeStatus: data.runtimeStatus,
      attemptedRuntimeMode: data.attemptedRuntimeMode,
      runtimeMode: data.runtimeMode,
      runtimeErrorReason: data.runtimeErrorReason,
      answerPreview: data.answer.slice(0, 260),
    },
    null,
    2,
  ),
);
