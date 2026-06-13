"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { navItems } from "@/components/dashboard/data";
import { icons, type IconName } from "@/components/dashboard/icons";
import { RunBriefButton } from "@/components/dashboard/run-brief-button";
import { cn } from "@/lib/utils";

interface DashboardAuthStatus {
  authEnabled: boolean;
  authRequired: boolean;
  state: "disabled" | "signed_in" | "signed_out" | "misconfigured";
  email: string | null;
  displayName: string | null;
  workspaceCount: number;
  role: string;
  isOwnerOrAdmin: boolean;
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-indigo-700 text-white shadow-[0_16px_32px_rgba(99,102,241,0.28)]">
        <div className="absolute inset-2 rounded-xl border border-white/30" />
        <div className="size-4 rounded-md border-4 border-white/90" />
      </div>
      <div>
        <div className="text-xl font-bold tracking-tight text-slate-950">CMO Engine</div>
        <div className="text-xs font-medium text-slate-500">Command Center</div>
      </div>
    </div>
  );
}

function AuthStatusCard({
  authStatus,
  compact = false,
}: {
  authStatus: DashboardAuthStatus;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const next = encodeURIComponent(pathname || "/");
  const title =
    authStatus.state === "signed_in"
      ? "Workspace Access"
      : authStatus.state === "signed_out"
        ? "Workspace Access"
        : authStatus.state === "misconfigured"
          ? "Workspace Access"
          : "Workspace Access";
  const subtitle =
    authStatus.state === "signed_in"
      ? "Signed in"
      : authStatus.state === "signed_out"
        ? authStatus.authRequired
          ? "Sign in required"
          : "Signed in"
        : authStatus.state === "misconfigured"
          ? "Access configuration pending"
          : "Signed in";

  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white p-4 shadow-sm", compact && "min-w-0 p-3")}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "size-2 rounded-full",
            authStatus.state === "signed_in" && "bg-emerald-500",
            authStatus.state === "signed_out" && "bg-slate-400",
            authStatus.state === "disabled" && "bg-orange-500",
            authStatus.state === "misconfigured" && "bg-red-500",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-950">{title}</div>
          <div className="truncate text-xs text-slate-500">{subtitle}</div>
        </div>
      </div>
      {authStatus.authEnabled ? (
        <div className="mt-3 flex gap-2">
          {authStatus.state === "signed_in" ? (
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="outline" size="sm">
                Logout
              </Button>
            </form>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={`/login?next=${next}`}>Login</Link>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function DashboardShell({
  children,
  authStatus,
}: {
  children: React.ReactNode;
  authStatus: DashboardAuthStatus;
}) {
  const pathname = usePathname();

  if (pathname.startsWith("/ui-preview/")) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#fbfcff] soft-grid">
      <aside className="thin-scrollbar fixed inset-y-0 left-0 z-40 hidden w-[282px] overflow-y-auto border-r border-slate-200/80 bg-white/88 backdrop-blur-xl xl:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-100 px-7 py-7">
            <Logo />
          </div>
          <nav className="flex-1 space-y-2 px-4 py-6">
            {navItems.filter((item) => !item.systemOnly || authStatus.isOwnerOrAdmin).map((item) => {
              const Icon = icons[item.icon as IconName];
              const active = item.href === "/" || item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group relative flex h-12 items-center gap-3 rounded-xl px-4 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 hover:text-indigo-700",
                    active && "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.08)]",
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="active-nav"
                      className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-50 to-violet-50"
                      transition={{ type: "spring", duration: 0.5 }}
                    />
                  )}
                  <Icon className="relative size-5" />
                  <span className="relative flex-1">{item.label}</span>
                  {"count" in item && item.count ? (
                    <span className="relative rounded-lg bg-violet-100 px-2 py-0.5 text-xs text-violet-700">
                      {item.count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
          <div className="space-y-4 p-5">
            <AuthStatusCard authStatus={authStatus} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-500">CMO System</div>
              <div className="mt-3 flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="font-bold text-emerald-700">Hermes CMO active</span>
              </div>
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
                Vault-backed workspace context.
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="xl:pl-[282px]">
        <div className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/86 px-4 py-4 backdrop-blur-xl lg:px-8 xl:hidden">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <Logo />
            <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-2 sm:flex sm:gap-3">
              <Badge variant="green">Hermes CMO active</Badge>
              <AuthStatusCard authStatus={authStatus} compact />
            </div>
          </div>
        </div>
        <main className="mx-auto w-full max-w-[1720px] px-4 py-6 lg:px-8 xl:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageChrome({
  title,
  description,
  children,
  primary = "Create Campaign",
  onPrimaryClick,
  actions,
  showRunBrief = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  primary?: string;
  onPrimaryClick?: () => void;
  actions?: React.ReactNode;
  showRunBrief?: boolean;
}) {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-2 text-base text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {actions ?? (
            <>
              {showRunBrief ? <RunBriefButton /> : null}
              {primary ? (
                <Button onClick={onPrimaryClick}>
                  <icons.Rocket />
                  {primary}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
