"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { navItems } from "@/components/dashboard/data";
import { Sparkline } from "@/components/dashboard/charts";
import { icons, type IconName } from "@/components/dashboard/icons";
import { RunBriefButton } from "@/components/dashboard/run-brief-button";
import { cn } from "@/lib/utils";

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

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#fbfcff] soft-grid">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[282px] border-r border-slate-200/80 bg-white/88 backdrop-blur-xl xl:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-100 px-7 py-7">
            <Logo />
          </div>
          <nav className="flex-1 space-y-2 px-4 py-6">
            {navItems.map((item) => {
              const Icon = icons[item.icon as IconName];
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="grid size-11 place-items-center rounded-full bg-gradient-to-br from-slate-200 to-slate-100 text-sm font-bold text-slate-700">
                  H
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-950">Holdstation</div>
                  <div className="text-xs text-slate-500">CMO</div>
                </div>
                <icons.ChevronDown className="size-4 text-slate-500" />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-500">CMO Engine Status</div>
              <div className="mt-3 flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="font-bold text-emerald-600">Live</span>
              </div>
              <Sparkline tone="violet" className="mt-4" />
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>Uptime</span>
                <span className="font-bold text-slate-950">99.9%</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="xl:pl-[282px]">
        <div className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/86 px-4 py-4 backdrop-blur-xl lg:px-8 xl:hidden">
          <div className="flex items-center justify-between gap-4">
            <Logo />
            <Badge variant="green">Live</Badge>
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
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  primary?: string;
  onPrimaryClick?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="space-y-6"
    >
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-2 text-base text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RunBriefButton />
          <Button onClick={onPrimaryClick}>
            <icons.Rocket />
            {primary}
          </Button>
        </div>
      </header>
      {children}
    </motion.div>
  );
}
