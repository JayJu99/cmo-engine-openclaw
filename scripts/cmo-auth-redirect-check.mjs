const modulePath = new URL("../src/lib/cmo/redirects.ts", import.meta.url);
const {
  getPublicAppOrigin,
  toPublicRedirectUrl,
  toSafeRelativePath,
} = await import(modulePath.href);

function headers(values = {}) {
  return {
    get(name) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    process.exit(1);
  }
}

const originalPublicUrl = process.env.CMO_PUBLIC_APP_URL;
const originalNodeEnv = process.env.NODE_ENV;

process.env.NODE_ENV = "production";
delete process.env.CMO_PUBLIC_APP_URL;

const forwardedRequest = {
  url: "http://localhost:3002/auth/sign-in",
  headers: headers({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "cmo.jayju.cloud",
    host: "localhost:3002",
  }),
};

assert(toSafeRelativePath(null) === "/", "Missing next should default to /.");
assert(
  toSafeRelativePath("/apps/holdstation-mini-app?tab=sessions") ===
    "/apps/holdstation-mini-app?tab=sessions",
  "Safe relative next should be preserved.",
);
assert(
  toSafeRelativePath("https://evil.com") === "/",
  "External next URL should be rejected.",
);
assert(toSafeRelativePath("//evil.com") === "/", "Protocol-relative next URL should be rejected.");

assert(
  toPublicRedirectUrl(forwardedRequest, null).href === "https://cmo.jayju.cloud/",
  "Default sign-in redirect should use public forwarded origin.",
);
assert(
  toPublicRedirectUrl(forwardedRequest, "/apps/holdstation-mini-app?tab=sessions").href ===
    "https://cmo.jayju.cloud/apps/holdstation-mini-app?tab=sessions",
  "Safe next should redirect on public forwarded origin.",
);
assert(
  toPublicRedirectUrl(forwardedRequest, "https://evil.com").href === "https://cmo.jayju.cloud/",
  "External next should redirect to public root.",
);
assert(
  toPublicRedirectUrl(forwardedRequest, "/login?error=signed_out", { allowAuthPaths: true }).href ===
    "https://cmo.jayju.cloud/login?error=signed_out",
  "Logout should redirect to public login page.",
);
assert(
  toPublicRedirectUrl(forwardedRequest, "/login?error=signed_out").href ===
    "https://cmo.jayju.cloud/",
  "Untrusted next-style login redirects should be normalized away from auth pages.",
);

process.env.CMO_PUBLIC_APP_URL = "https://cmo.jayju.cloud";

assert(
  getPublicAppOrigin({
    url: "http://localhost:3002/auth/sign-in",
    headers: headers({ host: "localhost:3002" }),
  }) === "https://cmo.jayju.cloud",
  "CMO_PUBLIC_APP_URL should override internal localhost origin.",
);

if (originalPublicUrl === undefined) {
  delete process.env.CMO_PUBLIC_APP_URL;
} else {
  process.env.CMO_PUBLIC_APP_URL = originalPublicUrl;
}

if (originalNodeEnv === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = originalNodeEnv;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "missing next defaults to /",
        "safe relative next preserved",
        "external next rejected",
        "forwarded public origin preferred",
        "CMO_PUBLIC_APP_URL preferred",
        "localhost avoided in production redirects",
      ],
    },
    null,
    2,
  ),
);
