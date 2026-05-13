"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import type { CmoChatRunListResponse, CmoRun, CmoRunIndexItem, CmoRunListResponse } from "@/lib/cmo/types";
import { cn } from "@/lib/utils";

type HealthTone = "ok" | "warn" | "error" | "info";

type CmoStatusResponse = {
  ok?: boolean;
  adapter?: string;
  mode?: string;
  data_dir?: string;
  data_dir_exists?: boolean;
  gateway_mode?: string;
  trigger_mode?: string;
  openclaw_trigger_enabled?: boolean;
  openclaw_runtime?: string;
  [key: string]: unknown;
};

type EndpointState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
};

const emptyEndpoint = { data: null, error: null, loading: true };

const commands = [
  {
    title: "Check dashboard service",
    command: "systemctl --user status cmo-engine-dashboard.service --no-pager",
    icon: "Activity",
  },
  {
    title: "Check adapter service",
    command: "systemctl --user status cmo-engine-adapter.service --no-pager",
    icon: "Radio",
  },
  {
    title: "Restart dashboard",
    command: "systemctl --user restart cmo-engine-dashboard.service",
    icon: "RefreshCw",
  },
  {
    title: "Restart adapter",
    command: "systemctl --user restart cmo-engine-adapter.service",
    icon: "RefreshCw",
  },
  {
    title: "View dashboard logs",
    command: "journalctl --user -u cmo-engine-dashboard.service -n 120 --no-pager",
    icon: "FileText",
  },
  {
    title: "View adapter logs",
    command: "journalctl --user -u cmo-engine-adapter.service -n 120 --no-pager",
    icon: "FileText",
  },
  {
    title: "Check OpenClaw Gateway",
    command: "openclaw gateway status",
    icon: "Zap",
  },
  {
    title: "Check Traefik",
    command: 'sudo docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}" | grep -E "traefik|n8n"',
    icon: "ShieldCheck",
  },
] as const;

function endpoint<T>(): EndpointState<T> {
  return { ...emptyEndpoint };
}

async function readJsonResponse<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const message = typeof record?.error === "string" ? record.error : `${path} failed to load`;

    throw new Error(message);
  }

  return payload as T;
}

function statusVariant(tone: HealthTone): BadgeProps["variant"] {
  if (tone === "ok") {
    return "green";
  }

  if (tone === "warn") {
    return "orange";
  }

  if (tone === "error") {
    return "red";
  }

  return "blue";
}

function displayDate(value: string | undefined): string {
  if (!value) {
    return "Unavailable";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function shortId(value: string | undefined): string {
  if (!value) {
    return "Unavailable";
  }

  return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

function runTone(status: string | undefined): HealthTone {
  if (!status) {
    return "warn";
  }

  if (status === "completed" || status === "Done") {
    return "ok";
  }

  if (status === "running" || status === "Running") {
    return "info";
  }

  if (status === "partial" || status === "mock") {
    return "warn";
  }

  return "error";
}

function HealthCard({
  title,
  value,
  detail,
  tone,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  tone: HealthTone;
  icon: keyof typeof icons;
}) {
  const Icon = icons[icon];

  return (
    <Card className="p-5 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-[0_24px_60px_rgba(15,23,42,0.09)]">
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
          <Icon className="size-5" />
        </div>
        <Badge variant={statusVariant(tone)}>{value}</Badge>
      </div>
      <div className="mt-5 text-xs font-semibold text-slate-500">{title}</div>
      <div className="mt-2 min-h-12 text-sm font-medium leading-6 text-slate-700">{detail}</div>
    </Card>
  );
}

type HealthCardItem = {
  title: string;
  value: string;
  detail: string;
  tone: HealthTone;
  icon: keyof typeof icons;
};

function WarningPanel({ errors }: { errors: string[] }) {
  if (!errors.length) {
    return null;
  }

  return (
    <Card className="border-orange-100 bg-orange-50/60 p-5">
      <div className="flex gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-700 ring-1 ring-orange-100">
          <icons.AlertTriangle className="size-5" />
        </div>
        <div>
          <CardTitle>Some Ops data is unavailable</CardTitle>
          <CardDescription className="mt-2">
            The page remains usable. Check the affected service or retry after the adapter is reachable.
          </CardDescription>
          <div className="mt-4 space-y-2">
            {errors.map((error) => (
              <div key={error} className="rounded-xl border border-orange-100 bg-white/70 px-3 py-2 text-sm font-semibold text-orange-800">
                {error}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function CommandCard({
  title,
  command,
  icon,
}: {
  title: string;
  command: string;
  icon: keyof typeof icons;
}) {
  const [copied, setCopied] = useState(false);
  const Icon = icons[icon];

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-600 ring-1 ring-slate-200">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{title}</CardTitle>
            <div className="mt-1 text-xs font-semibold text-slate-500">Safe to copy; run on the VPS shell</div>
          </div>
        </div>
        <Button size="sm" variant={copied ? "soft" : "outline"} onClick={() => void copyCommand()}>
          {copied ? <icons.Check /> : <icons.Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100 thin-scrollbar">
        <code>{command}</code>
      </pre>
    </Card>
  );
}

function CountStrip({
  runs,
  chats,
}: {
  runs: CmoRunListResponse | null;
  chats: CmoChatRunListResponse | null;
}) {
  const items = [
    { label: "Recent Runs", value: runs?.data.length ?? 0, icon: icons.List },
    { label: "Runs Total", value: runs?.total ?? 0, icon: icons.Database },
    { label: "Recent Chats", value: chats?.data.length ?? 0, icon: icons.MessageSquare },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <Card key={item.label} className="p-5">
            <div className="flex items-center gap-4">
              <div className="grid size-12 place-items-center rounded-2xl bg-violet-50 text-violet-700 ring-1 ring-violet-100">
                <Icon className="size-5" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">{item.label}</div>
                <div className="mt-1 text-3xl font-bold text-slate-950">{item.value}</div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function RecentPanel({
  runs,
  chats,
}: {
  runs: CmoRunIndexItem[];
  chats: CmoChatRunListResponse["data"];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Recent Runs</CardTitle>
            <CardDescription className="mt-1">Compact status only; no raw OpenClaw payloads.</CardDescription>
          </div>
          <Badge variant="slate">{runs.length}</Badge>
        </div>
        <div className="mt-5 space-y-3">
          {runs.length ? (
            runs.map((run) => (
              <div key={run.run_id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-bold text-slate-950">{run.title}</div>
                    <div className="mt-1 font-mono text-xs font-semibold text-slate-500">{shortId(run.run_id)}</div>
                  </div>
                  <Badge variant={statusVariant(runTone(run.status))}>{run.status}</Badge>
                </div>
                <div className="mt-2 text-xs font-medium text-slate-500">{displayDate(run.created_at)}</div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-500">
              No recent runs returned.
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Recent Chat History</CardTitle>
            <CardDescription className="mt-1">Availability check uses chat metadata only.</CardDescription>
          </div>
          <Badge variant="slate">{chats.length}</Badge>
        </div>
        <div className="mt-5 space-y-3">
          {chats.length ? (
            chats.map((chat) => (
              <div key={chat.chat_run_id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-bold text-slate-950">{chat.question || "Untitled chat"}</div>
                    <div className="mt-1 font-mono text-xs font-semibold text-slate-500">{shortId(chat.chat_run_id)}</div>
                  </div>
                  <Badge variant={chat.status === "completed" ? "green" : chat.status === "running" ? "blue" : "red"}>
                    {chat.status}
                  </Badge>
                </div>
                <div className="mt-2 text-xs font-medium text-slate-500">{displayDate(chat.created_at)}</div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-500">
              No recent chat history returned.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export function OpsView() {
  const [status, setStatus] = useState<EndpointState<CmoStatusResponse>>(endpoint);
  const [latest, setLatest] = useState<EndpointState<CmoRun>>(endpoint);
  const [runs, setRuns] = useState<EndpointState<CmoRunListResponse>>(endpoint);
  const [chats, setChats] = useState<EndpointState<CmoChatRunListResponse>>(endpoint);

  useEffect(() => {
    let cancelled = false;

    async function loadOps() {
      const [nextStatus, nextLatest, nextRuns, nextChats] = await Promise.all([
        readJsonResponse<CmoStatusResponse>("/api/cmo/status")
          .then((data) => ({ data, error: null, loading: false }))
          .catch((error) => ({ data: null, error: error instanceof Error ? error.message : "Status failed to load", loading: false })),
        readJsonResponse<CmoRun>("/api/cmo/runs/latest")
          .then((data) => ({ data, error: null, loading: false }))
          .catch((error) => ({ data: null, error: error instanceof Error ? error.message : "Latest run failed to load", loading: false })),
        readJsonResponse<CmoRunListResponse>("/api/cmo/runs?limit=5")
          .then((data) => ({ data, error: null, loading: false }))
          .catch((error) => ({ data: null, error: error instanceof Error ? error.message : "Recent runs failed to load", loading: false })),
        readJsonResponse<CmoChatRunListResponse>("/api/cmo/chat?limit=5")
          .then((data) => ({ data, error: null, loading: false }))
          .catch((error) => ({ data: null, error: error instanceof Error ? error.message : "Recent chat failed to load", loading: false })),
      ]);

      if (!cancelled) {
        setStatus(nextStatus);
        setLatest(nextLatest);
        setRuns(nextRuns);
        setChats(nextChats);
      }
    }

    void loadOps();

    return () => {
      cancelled = true;
    };
  }, []);

  const latestSuccessful = useMemo(() => {
    const recentSuccess = runs.data?.data.find((run) => run.status === "completed" || run.status === "Done") ?? null;

    if (recentSuccess) {
      return {
        id: recentSuccess.run_id,
        createdAt: recentSuccess.created_at,
      };
    }

    if (latest.data && (latest.data.status === "completed" || latest.data.status === "Done")) {
      return {
        id: latest.data.run_id,
        createdAt: latest.data.created_at,
      };
    }

    return null;
  }, [latest.data, runs.data]);

  const errors = [status.error, latest.error, runs.error, chats.error].filter((error): error is string => Boolean(error));
  const statusData = status.data;
  const adapterOk = statusData?.ok === true && !status.error;
  const latestStatusTone = runTone(latest.data?.status);
  const chatCount = chats.data?.data.length ?? 0;
  const triggerEnabled = statusData?.openclaw_trigger_enabled === true;
  const triggerMode = typeof statusData?.trigger_mode === "string" ? statusData.trigger_mode : "Unavailable";
  const dataDirExists = statusData?.data_dir_exists;

  const healthCards: HealthCardItem[] = [
    {
      title: "Dashboard",
      value: "Loaded",
      detail: "Next.js app shell and Ops client view are responding.",
      tone: "ok" as HealthTone,
      icon: "Home" as keyof typeof icons,
    },
    {
      title: "VPS Adapter",
      value: status.loading ? "Checking" : adapterOk ? "Reachable" : "Warning",
      detail: adapterOk ? `Adapter: ${String(statusData?.adapter ?? "ok")}` : status.error ?? "Adapter status was not confirmed.",
      tone: status.loading ? "info" : adapterOk ? "ok" : "warn",
      icon: "Radio" as keyof typeof icons,
    },
    {
      title: "OpenClaw Trigger Mode",
      value: triggerMode,
      detail: triggerMode === "Unavailable" ? "Trigger mode was not returned by status." : "Reported by the local dashboard adapter route.",
      tone: triggerMode === "openclaw-cron" ? "ok" : triggerMode === "Unavailable" ? "warn" : "info",
      icon: "Zap" as keyof typeof icons,
    },
    {
      title: "OpenClaw Trigger Enabled",
      value: triggerEnabled ? "Enabled" : "Disabled",
      detail: triggerEnabled ? "Run Brief requests should enqueue OpenClaw CMO work." : "OpenClaw triggering is not active in this mode.",
      tone: triggerEnabled ? "ok" : "warn",
      icon: "Play" as keyof typeof icons,
    },
    {
      title: "Data Directory Exists",
      value: dataDirExists === true ? "Exists" : dataDirExists === false ? "Missing" : "Unknown",
      detail: typeof statusData?.data_dir === "string" ? statusData.data_dir : "No data directory path returned.",
      tone: dataDirExists === true ? "ok" : dataDirExists === false ? "error" : "warn",
      icon: "Database" as keyof typeof icons,
    },
    {
      title: "Latest Run Status",
      value: latest.loading ? "Checking" : latest.data?.status ?? "Unavailable",
      detail: latest.data ? `${shortId(latest.data.run_id)} / ${displayDate(latest.data.created_at)}` : latest.error ?? "Latest run status is unavailable.",
      tone: latest.loading ? "info" : latestStatusTone,
      icon: "List" as keyof typeof icons,
    },
    {
      title: "Latest Successful Run",
      value: latestSuccessful ? "Available" : "Unavailable",
      detail: latestSuccessful ? `${shortId(latestSuccessful.id)} / ${displayDate(latestSuccessful.createdAt)}` : "No completed run found in the latest API responses.",
      tone: latestSuccessful ? "ok" : "warn",
      icon: "CheckCircle2" as keyof typeof icons,
    },
    {
      title: "Recent Chat History",
      value: chats.loading ? "Checking" : chatCount > 0 ? "Available" : "Empty",
      detail: chats.error ?? `${chatCount} recent chat ${chatCount === 1 ? "entry" : "entries"} returned.`,
      tone: chats.loading ? "info" : chats.error ? "warn" : chatCount > 0 ? "ok" : "info",
      icon: "MessageSquare" as keyof typeof icons,
    },
  ];

  return (
    <PageChrome title="Ops & Maintenance" description="Check dashboard health and copy VPS maintenance commands" primary="Refresh" onPrimaryClick={() => window.location.reload()}>
      <WarningPanel errors={errors} />

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {healthCards.map((card) => (
          <HealthCard key={card.title} {...card} />
        ))}
      </div>

      <CountStrip runs={runs.data} chats={chats.data} />

      <RecentPanel runs={runs.data?.data ?? []} chats={chats.data?.data ?? []} />

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-950">Maintenance Commands</h2>
            <p className="mt-1 text-sm text-slate-500">Copy snippets only. No secrets or raw debug payloads are shown.</p>
          </div>
          <Badge variant={errors.length ? "orange" : "green"} className={cn(errors.length === 0 && "border-emerald-100")}>
            {commands.length} snippets
          </Badge>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {commands.map((command) => (
            <CommandCard key={command.title} {...command} />
          ))}
        </div>
      </section>
    </PageChrome>
  );
}
