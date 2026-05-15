const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const expectedReason = process.env.CMO_SMOKE_EXPECT_REASON || "unsupported_chat_turn";
const allowedReasons = new Set(["unsupported_chat_turn", "timeout", "invalid_response", "empty_answer", "execution_error"]);

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

const response = await fetch(`${baseUrl}/api/cmo/chat`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});
const data = await response.json().catch(() => null);

assert(response.ok, `Expected HTTP 2xx from ${baseUrl}/api/cmo/chat`, data);
assert(data?.status === "completed", "Expected completed session status", data);
assert(data?.runtimeStatus === "live_failed_then_fallback", "Expected live runtime attempt to fall back", data);
assert(data?.attemptedRuntimeMode === "live", "Expected attemptedRuntimeMode=live", data);
assert(data?.runtimeMode === "fallback", "Expected runtimeMode=fallback", data);
assert(data?.isRuntimeFallback === true, "Expected isRuntimeFallback=true", data);
assert(allowedReasons.has(data?.runtimeErrorReason), "Expected a controlled runtimeErrorReason", data);

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
