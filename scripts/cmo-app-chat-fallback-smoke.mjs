const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
const forceFallback = process.env.CMO_SMOKE_FORCE_FALLBACK !== "0";
const expectedReason = process.env.CMO_SMOKE_EXPECT_REASON || (forceFallback ? "execution_error" : "any");
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
  return /## Recommended Actions/i.test(answer) || /Action\s+1:/i.test(answer) || /recommended|recommendation|focus this/i.test(answer);
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

const auth = authorizationHeader();
const headers = {
  "Content-Type": "application/json",
  ...(auth ? { Authorization: auth } : {}),
};

async function postChat(message, topic) {
  const payload = {
    workspaceId: "holdstation",
    appId: "holdstation-mini-app",
    appName: "Holdstation Mini App",
    message,
    topic,
    ...(forceFallback ? { forceFallback: true } : {}),
    context: {
      selectedNotes: [],
      mode: "app_context",
      ...(forceFallback ? { forceFallback: true } : {}),
    },
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

  return data;
}

function assertFallbackMetadata(data) {
  assert(data.status === "completed", "Expected completed session status", data);
  assert(data.runtimeStatus === "live_failed_then_fallback", "Expected live runtime attempt to fall back", data);
  assert(data.attemptedRuntimeMode === "live", "Expected attemptedRuntimeMode=live", data);
  assert(data.runtimeMode === "fallback", "Expected runtimeMode=fallback", data);
  assert(data.isRuntimeFallback === true, "Expected isRuntimeFallback=true", data);
  assert(allowedReasons.has(data.runtimeErrorReason), "Expected a controlled runtimeErrorReason", data);

  if (expectedReason !== "any") {
    assert(data.runtimeErrorReason === expectedReason, `Expected runtimeErrorReason=${expectedReason}`, data);
  }
}

const greeting = await postChat("hi", "Phase 1.86D fallback greeting smoke");
assertFallbackMetadata(greeting);
assert(typeof greeting.answer === "string" && greeting.answer.trim().length > 80, "Expected a conversational greeting answer", greeting);
assert(/Hi Jay|I'm ready|I’m ready/i.test(greeting.answer), "Expected greeting to respond conversationally", greeting.answer);
assert(!/## Recommended Actions/i.test(greeting.answer), "Greeting should not return recommendation template", greeting.answer);
assert(/Runtime Note/i.test(greeting.answer), "Greeting should include runtime note", greeting.answer);

const recommendation = await postChat(
  "Based on the current priority and App Memory, give me 3 recommended CMO actions for Holdstation Mini App this week. Also state which context you used.",
  "Phase 1.86D fallback recommendation smoke",
);
assertFallbackMetadata(recommendation);
assert(typeof recommendation.answer === "string" && recommendation.answer.trim().length > 120, "Expected a useful fallback answer", recommendation);
assert(!recommendation.answer.trim().startsWith("Fallback response:"), "Expected answer to be more than diagnostics", recommendation.answer);
assert(containsRecommendation(recommendation.answer), "Expected at least one recommendation in answer", recommendation.answer);
assert(containsContextUsed(recommendation.answer), "Expected answer to include context used", recommendation.answer);
assert(/Runtime Note/i.test(recommendation.answer), "Recommendation should include runtime note", recommendation.answer);

console.log(
  JSON.stringify(
    {
      ok: true,
      greeting: {
        sessionId: greeting.sessionId,
        runtimeStatus: greeting.runtimeStatus,
        runtimeErrorReason: greeting.runtimeErrorReason,
        forcedFallback: forceFallback,
        answerPreview: greeting.answer.slice(0, 220),
      },
      recommendation: {
        sessionId: recommendation.sessionId,
        runtimeStatus: recommendation.runtimeStatus,
        runtimeErrorReason: recommendation.runtimeErrorReason,
        forcedFallback: forceFallback,
        answerPreview: recommendation.answer.slice(0, 260),
      },
    },
    null,
    2,
  ),
);
