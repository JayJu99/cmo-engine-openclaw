const guardModulePath = new URL("../src/lib/cmo/auth-route-guard.ts", import.meta.url);
const redirectModulePath = new URL("../src/lib/cmo/redirects.ts", import.meta.url);
const {
  isSupabaseAuthProtectedPath,
  isSupabaseAuthPublicPath,
} = await import(guardModulePath.href);
const { toPublicRedirectUrl, toSafeRelativePath } = await import(redirectModulePath.href);

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

const protectedPages = [
  "/",
  "/apps",
  "/apps/holdstation-mini-app",
  "/chat",
  "/vault",
  "/daily",
  "/runs",
  "/reports",
  "/signals",
  "/pipeline",
  "/ops",
  "/actions",
  "/agents",
];

const publicPaths = [
  "/login",
  "/logout",
  "/auth/sign-in",
  "/auth/callback",
  "/_next/static/chunk.js",
  "/favicon.ico",
];

for (const pathname of protectedPages) {
  assert(isSupabaseAuthProtectedPath(pathname), `Expected protected path: ${pathname}`);
}

for (const pathname of publicPaths.slice(0, 4)) {
  assert(isSupabaseAuthPublicPath(pathname), `Expected public auth path: ${pathname}`);
  assert(!isSupabaseAuthProtectedPath(pathname), `Expected public path not protected: ${pathname}`);
}

for (const pathname of publicPaths.slice(4)) {
  assert(!isSupabaseAuthProtectedPath(pathname), `Expected static asset path not protected by auth list: ${pathname}`);
}

const publicRequest = {
  url: "http://localhost:3002/",
  headers: headers({
    "x-forwarded-proto": "https",
    "x-forwarded-host": "cmo.jayju.cloud",
    host: "localhost:3002",
  }),
};

assert(
  toPublicRedirectUrl(publicRequest, `/login?next=${encodeURIComponent("/")}`, {
    allowAuthPaths: true,
  }).href === "https://cmo.jayju.cloud/login?next=%2F",
  "Root unauthenticated redirect should point at public login with next=/.",
);
assert(
  toPublicRedirectUrl(
    publicRequest,
    `/login?next=${encodeURIComponent("/apps/holdstation-mini-app")}`,
    { allowAuthPaths: true },
  ).href === "https://cmo.jayju.cloud/login?next=%2Fapps%2Fholdstation-mini-app",
  "App page unauthenticated redirect should point at public login.",
);
assert(toSafeRelativePath("https://evil.com") === "/", "External next URLs should be rejected.");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "root path protected",
        "dashboard page paths protected",
        "login/logout/auth paths public",
        "static asset paths not protected by auth route list",
        "root redirect target uses public login",
        "external next rejected",
      ],
    },
    null,
    2,
  ),
);
