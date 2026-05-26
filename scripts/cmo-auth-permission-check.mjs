const permissionModelPath = new URL("../src/lib/cmo/permission-model.ts", import.meta.url);
const routeGuardPath = new URL("../src/lib/cmo/auth-route-guard.ts", import.meta.url);
const {
  CMO_NORMAL_WORKSPACE_ACCESS,
  canUseNormalWorkspace,
  highestAccessRole,
  isOwnerOrAdmin,
} = await import(permissionModelPath.href);
const { isSupabaseAuthProtectedPath, isSupabaseAuthPublicPath } = await import(routeGuardPath.href);

function assert(condition, message, detail) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    if (detail !== undefined) {
      console.error(detail);
    }
    process.exit(1);
  }
}

assert(CMO_NORMAL_WORKSPACE_ACCESS === "authenticated", "Normal workspace access should be auth-only.");
assert(canUseNormalWorkspace(true), "Authenticated members should access normal workspaces.");
assert(!canUseNormalWorkspace(false), "Unauthenticated users should not access normal workspaces.");
assert(isOwnerOrAdmin("owner"), "Owner should pass system/admin helper.");
assert(isOwnerOrAdmin("admin"), "Admin should pass system/admin helper.");
assert(!isOwnerOrAdmin("member"), "Member should not pass system/admin helper.");
assert(!isOwnerOrAdmin("viewer"), "Viewer should not pass system/admin helper.");
assert(highestAccessRole(["viewer", "member"]) === "member", "Highest role should choose member.");
assert(highestAccessRole(["member", "admin"]) === "admin", "Highest role should choose admin.");
assert(isSupabaseAuthProtectedPath("/apps/holdstation-mini-app"), "Normal workspace route should require login.");
assert(!isSupabaseAuthPublicPath("/apps/holdstation-mini-app"), "Normal workspace route should not be public.");
assert(isSupabaseAuthPublicPath("/login"), "Login should stay public.");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "normal workspace access is authenticated-user based",
        "unauthenticated users do not access normal workspaces",
        "owner/admin helper passes owner and admin",
        "member helper fails system/admin",
        "normal workspace route is login-gated, not membership-gated",
        "login remains public",
      ],
    },
    null,
    2,
  ),
);
