const baseUrl = (process.env.CMO_SMOKE_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
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

function isDashboardJsonText(value) {
  return /"schema_version"\s*:\s*"cmo\.dashboard\.v1"/i.test(value) ||
    /"summary"\s*:/i.test(value) ||
    /"actions"\s*:/i.test(value) ||
    /"signals"\s*:/i.test(value) ||
    /"agents"\s*:/i.test(value);
}

const auth = authorizationHeader();
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(auth ? { Authorization: auth } : {}),
  },
  body: JSON.stringify({
    workspaceId: "holdstation",
    appId: "holdstation-mini-app",
    appName: "Holdstation Mini App",
    message: "hi, introduce yourself as the CMO for this workspace",
    topic: "Phase 1.87 live app-turn smoke",
    context: {
      selectedNotes: [],
      mode: "app_context",
    },
  }),
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

assert(response.ok, `Expected HTTP 2xx from ${endpoint}`, {
  status: response.status,
  statusText: response.statusText,
  contentType,
  rawBody: rawBody.slice(0, 1000),
});
assert(data && typeof data === "object", "Expected JSON response body", rawBody.slice(0, 1000));
assert(data.status === "completed", "Expected completed session", data);
assert(typeof data.answer === "string" && data.answer.trim().length > 0, "Expected non-empty live answer", data);
assert(data.runtimeMode === "live", "Expected runtimeMode=live", data);
assert(data.runtimeStatus === "live", "Expected runtimeStatus=live", data);
assert(data.isRuntimeFallback === false, "Expected isRuntimeFallback=false", data);
assert(data.attemptedRuntimeMode === "live", "Expected attemptedRuntimeMode=live", data);
assert(!/Live app-chat is unavailable/i.test(data.answer), "Live answer must not include fallback unavailable copy", data.answer);
assert(!/Runtime Note/i.test(data.answer), "Live answer must not include fallback Runtime Note", data.answer);
assert(!isDashboardJsonText(data.answer), "Live answer must not be dashboard JSON", data.answer);

console.log(
  JSON.stringify(
    {
      ok: true,
      sessionId: data.sessionId,
      runtimeMode: data.runtimeMode,
      runtimeStatus: data.runtimeStatus,
      answerPreview: data.answer.slice(0, 260),
    },
    null,
    2,
  ),
);
