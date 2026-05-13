"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MiniProgress, Sparkline } from "@/components/dashboard/charts";
import {
  actions as fallbackActions,
  agents as fallbackAgents,
  campaigns as fallbackCampaigns,
  reports as fallbackReports,
  signals as fallbackSignals,
  vaultItems as fallbackVaultItems,
} from "@/components/dashboard/data";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import { cn } from "@/lib/utils";

type Tone = "violet" | "green" | "blue" | "orange" | "pink" | "slate" | "red";
type UIAction = {
  id?: string;
  title: string;
  summary: string;
  priority: string;
  source: string;
  agent: string;
  time: string;
  type: string;
};
type UISignal = {
  id?: string;
  title: string;
  summary: string;
  category: string;
  source: string;
  severity: string;
  time: string;
};
type UIAgent = {
  name: string;
  codename: string;
  status: string;
  tone: string;
  progress: number;
  description: string;
  activity: string;
  metricA: string;
  metricB: string;
};
type UIReport = {
  title: string;
  type: string;
  meta: string;
  stats: string[];
  tone: string;
};
type UIVaultItem = {
  name: string;
  type: string;
  status: string;
  count: string;
  tone: string;
};
type UICampaign = {
  id?: string;
  name?: string;
  title?: string;
  channels: string[] | string;
  stage: string;
  owner?: string;
  agent?: string;
  owner_agent?: string;
  status: string;
  progress: number;
  updated?: string;
  last_updated?: string;
  summary?: string;
  next_action?: string;
  tone: string;
};
type DashboardViewData = Partial<{
  actions: UIAction[];
  signals: UISignal[];
  agents: UIAgent[];
  campaigns: UICampaign[];
  reports: UIReport[];
  vault: UIVaultItem[];
}>;

function splitOwnerAgent(campaign: UICampaign) {
  if (campaign.owner && campaign.agent) {
    return { owner: campaign.owner, agent: campaign.agent };
  }

  const match = campaign.owner_agent?.match(/^(.*?)\s*\((.*?)\)$/);

  if (match) {
    return { owner: match[1], agent: match[2] };
  }

  return {
    owner: campaign.owner_agent ?? campaign.owner ?? "CMO Agent",
    agent: campaign.agent ?? "CMO",
  };
}

function normalizeUICampaign(campaign: UICampaign) {
  const owner = splitOwnerAgent(campaign);

  return {
    ...campaign,
    name: campaign.name ?? campaign.title ?? "Untitled Campaign",
    channels: Array.isArray(campaign.channels) ? campaign.channels.join("  ") : campaign.channels,
    owner: owner.owner,
    agent: owner.agent,
    updated: campaign.last_updated ?? campaign.updated ?? "Just now",
  };
}

function askCmoQuestion(intent: "action" | "signal" | "campaign", title: string) {
  if (intent === "action") {
    return `Explain this action and recommend the next 3 concrete steps: ${title}`;
  }

  if (intent === "signal") {
    return `Analyze this signal and tell me what campaign/content decision it should affect: ${title}`;
  }

  return `Review this campaign and tell me what to approve, change, or block next: ${title}`;
}

function askCmoHref(intent: "action" | "signal" | "campaign", id: string | undefined, title: string) {
  const params = new URLSearchParams();

  if (id) {
    params.set("intent", intent);
    params.set("id", id);
  } else {
    params.set("question", askCmoQuestion(intent, title));
  }

  return `/chat?${params.toString()}`;
}

function resolveDashboardData(data?: DashboardViewData) {
  return {
    actions: data?.actions?.length ? data.actions : fallbackActions,
    signals: data?.signals?.length ? data.signals : fallbackSignals,
    agents: data?.agents?.length ? data.agents : fallbackAgents,
    campaigns: data?.campaigns?.length ? data.campaigns.map(normalizeUICampaign) : fallbackCampaigns,
    reports: data?.reports?.length ? data.reports : fallbackReports,
    vault: data?.vault?.length ? data.vault : fallbackVaultItems,
  };
}

const tone = {
  violet: {
    tile: "bg-violet-50 text-violet-700 ring-violet-100",
    border: "border-violet-200",
    soft: "bg-violet-50 text-violet-700",
    gradient: "from-violet-600 to-indigo-600",
  },
  green: {
    tile: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    border: "border-emerald-200",
    soft: "bg-emerald-50 text-emerald-700",
    gradient: "from-emerald-500 to-green-600",
  },
  blue: {
    tile: "bg-blue-50 text-blue-700 ring-blue-100",
    border: "border-blue-200",
    soft: "bg-blue-50 text-blue-700",
    gradient: "from-blue-500 to-indigo-500",
  },
  orange: {
    tile: "bg-orange-50 text-orange-700 ring-orange-100",
    border: "border-orange-200",
    soft: "bg-orange-50 text-orange-700",
    gradient: "from-orange-500 to-amber-500",
  },
  pink: {
    tile: "bg-pink-50 text-pink-700 ring-pink-100",
    border: "border-pink-200",
    soft: "bg-pink-50 text-pink-700",
    gradient: "from-pink-500 to-rose-500",
  },
  slate: {
    tile: "bg-slate-50 text-slate-700 ring-slate-100",
    border: "border-slate-200",
    soft: "bg-slate-50 text-slate-700",
    gradient: "from-slate-500 to-slate-700",
  },
  red: {
    tile: "bg-red-50 text-red-700 ring-red-100",
    border: "border-red-200",
    soft: "bg-red-50 text-red-700",
    gradient: "from-red-500 to-rose-500",
  },
};

function IconTile({
  children,
  color = "violet",
  className,
}: {
  children: React.ReactNode;
  color?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("grid size-12 place-items-center rounded-2xl ring-1", tone[color].tile, className)}>
      {children}
    </div>
  );
}

function SearchToolbar({ placeholder = "Search..." }: { placeholder?: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative w-full sm:w-72">
        <icons.Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input placeholder={placeholder} className="pr-10" />
      </div>
      <Button variant="outline">
        <icons.Filter />
        Filter
        <icons.ChevronDown className="size-3" />
      </Button>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  delta,
  color = "violet",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta: string;
  color?: Tone;
}) {
  return (
    <Card className="p-5 transition hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(15,23,42,0.09)]">
      <div className="flex items-center gap-4">
        <IconTile color={color}>{icon}</IconTile>
        <div>
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
          <p className="mt-1 text-xs font-semibold text-emerald-600">{delta}</p>
        </div>
      </div>
    </Card>
  );
}

function SectionTitle({
  icon,
  title,
  action = "View all",
  color = "violet",
}: {
  icon: React.ReactNode;
  title: string;
  action?: string;
  color?: Tone;
}) {
  return (
    <CardHeader>
      <div className="flex items-center gap-3">
        <IconTile color={color} className="size-10 rounded-xl">
          {icon}
        </IconTile>
        <CardTitle>{title}</CardTitle>
      </div>
      <button className="flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-indigo-700">
        {action}
        <icons.ChevronRight className="size-4" />
      </button>
    </CardHeader>
  );
}

function PriorityBadge({ value }: { value: string }) {
  const variant = value === "High" ? "red" : value === "Medium" ? "orange" : value === "Low" ? "green" : "default";
  return <Badge variant={variant}>{value}</Badge>;
}

function StatusBadge({ value }: { value: string }) {
  const variant = value === "Running" || value === "Done" || value === "Indexed" || value === "Fresh" ? "green" : value === "Need Approval" || value === "Need Review" || value === "Review" ? "orange" : value === "Idle" || value === "In Progress" ? "blue" : "slate";
  return <Badge variant={variant}>{value}</Badge>;
}

function CampaignMark({ name, color = "violet" }: { name: string; color?: Tone }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

  return (
    <div className={cn("grid size-12 place-items-center rounded-xl bg-gradient-to-br text-sm font-black text-white shadow-lg", tone[color].gradient)}>
      {initials}
    </div>
  );
}

function SegmentTabs({ items }: { items: { label: string; count: number; color?: Tone }[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((item, index) => (
        <button
          key={item.label}
          className={cn(
            "flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:text-indigo-700",
            index === 0 && "border-violet-200 bg-violet-50 text-violet-700",
          )}
        >
          {item.label}
          <span className={cn("rounded-lg px-2 py-0.5 text-xs", item.color ? tone[item.color].soft : "bg-violet-100 text-violet-700")}>
            {item.count}
          </span>
        </button>
      ))}
    </div>
  );
}

function ActionRows({ actions, selected = false }: { actions: UIAction[]; selected?: boolean }) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[84px_minmax(240px,1fr)_140px_76px_78px] gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-xs font-semibold text-slate-500 max-lg:hidden">
        <span>Priority</span>
        <span>Action</span>
        <span>Source</span>
        <span>Time</span>
        <span>CTA</span>
      </div>
      {actions.map((action, index) => (
        <motion.div
          key={action.title}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.03 }}
          className={cn(
            "grid items-center gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0 lg:grid-cols-[84px_minmax(240px,1fr)_140px_76px_78px]",
            selected && index === 0 && "bg-violet-50/70 ring-1 ring-inset ring-violet-300",
          )}
        >
          <PriorityBadge value={action.priority} />
          <div className="flex items-center gap-4">
            <CampaignMark name={action.title} color={index === 0 ? "slate" : index === 3 ? "violet" : "green"} />
            <div>
              <div className="font-bold text-slate-950">{action.title}</div>
              <div className="mt-1 max-w-xl text-sm leading-6 text-slate-500">{action.summary}</div>
              <Badge className="mt-2" variant={action.priority === "Low" ? "green" : action.priority === "High" ? "default" : "orange"}>
                {action.type}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <IconTile color={action.source.includes("Research") ? "green" : action.source.includes("Lens") ? "blue" : "violet"} className="size-8 rounded-full">
              <icons.Bot className="size-4" />
            </IconTile>
            <div>
              <div className="font-semibold text-slate-900">{action.source}</div>
              <div className="text-slate-500">{action.agent}</div>
            </div>
          </div>
          <span className="text-sm font-medium text-slate-500">{action.time}</span>
          <Button size="sm" variant={index === 0 ? "default" : "outline"}>
            {index === 2 ? "View" : index === 1 || index === 4 ? "Open" : "Review"}
          </Button>
        </motion.div>
      ))}
      <div className="px-4 py-4 text-sm text-slate-500">Showing 1 to 5 of 5 actions</div>
    </Card>
  );
}

function DetailPanel({
  actions,
  signals,
  selectedCampaign,
  mode,
}: {
  actions: UIAction[];
  signals: UISignal[];
  selectedCampaign?: UICampaign;
  mode: "actions" | "signals" | "pipeline";
}) {
  const isSignal = mode === "signals";
  const isPipeline = mode === "pipeline";
  const activeAction = actions[0];
  const activeSignal = signals[0];
  const campaignName = selectedCampaign?.name ?? selectedCampaign?.title ?? "New Year Stonk";
  const campaignChannels = selectedCampaign
    ? Array.isArray(selectedCampaign.channels)
      ? selectedCampaign.channels.join("  ")
      : selectedCampaign.channels
    : "Facebook  X  Reddit";
  const campaignOwnerAgent = selectedCampaign?.owner_agent ?? `${selectedCampaign?.owner ?? "Content Agent"} (${selectedCampaign?.agent ?? "Echo"})`;
  const campaignStage = selectedCampaign?.stage ?? "Content";
  const campaignStatus = selectedCampaign?.status ?? "Running";
  const campaignProgress = selectedCampaign?.progress ?? 3;
  const campaignSummary =
    selectedCampaign?.summary ??
    "A New Year themed trading campaign to drive engagement with retail traders and promote platform activity.";
  const campaignNextAction =
    selectedCampaign?.next_action ?? "Review campaign progress and approve the next step";
  const campaignLastUpdated = selectedCampaign?.last_updated ?? selectedCampaign?.updated ?? "12 min ago";
  const campaignTone = (selectedCampaign?.tone ?? "violet") as Tone;
  const campaignStageIndex = Math.max(0, Math.min(5, Math.round(campaignProgress) - 1));
  const askIntent = isPipeline ? "campaign" : isSignal ? "signal" : "action";
  const askTitle = isPipeline ? campaignName : isSignal ? activeSignal?.title ?? "Selected signal" : activeAction?.title ?? "Selected action";
  const askId = isPipeline ? selectedCampaign?.id : isSignal ? activeSignal?.id : activeAction?.id;

  return (
    <Card className="h-fit p-6">
      <div className="mb-6 flex items-center justify-between">
        <button className="flex items-center gap-2 text-sm font-semibold text-slate-500">
          <icons.ChevronRight className="size-4 rotate-180" />
          Back to {isPipeline ? "pipeline" : "list"}
        </button>
        <div className="flex items-center gap-2">
          <Badge variant={isSignal ? "red" : isPipeline ? "default" : "red"}>{isPipeline ? campaignStage : isSignal ? "High Opportunity" : "High Priority"}</Badge>
          <Button asChild size="sm" variant="outline">
            <Link href={askCmoHref(askIntent, askId, askTitle)}>
              <icons.MessageSquare />
              Ask CMO
            </Link>
          </Button>
        </div>
      </div>

      {isPipeline ? (
        <div className="flex items-center gap-5">
          <CampaignMark name={campaignName} color={campaignTone} />
          <div>
            <h2 className="text-2xl font-bold text-slate-950">{campaignName}</h2>
            <p className="mt-1 text-sm text-slate-500">{campaignChannels}</p>
            <p className="mt-2 text-sm font-semibold text-violet-700">Owned by {campaignOwnerAgent}</p>
          </div>
        </div>
      ) : (
        <>
          <h2 className="text-2xl font-bold leading-tight text-slate-950">
            {isSignal ? activeSignal?.title : activeAction?.title}
          </h2>
          <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
            <IconTile color={isSignal ? "violet" : "violet"} className="size-7 rounded-full">
              {isSignal ? <icons.Radio className="size-4" /> : <icons.PencilLine className="size-4" />}
            </IconTile>
            {isSignal ? "Social Listening (Source)" : "Content Agent (Echo)"}
            <span>12 min ago</span>
          </div>
        </>
      )}

      <div className="mt-7 space-y-6">
        <div>
          <h3 className="text-sm font-bold text-slate-950">Summary</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            {isPipeline
              ? campaignSummary
              : isSignal
                ? "Meme-based angle is driving significantly higher engagement across Facebook, X, and Reddit compared to market news posts."
                : "Meme-based angle highlighting the risk of missing early stock opportunities in the market."}
          </p>
        </div>

        {isSignal ? (
          <div>
            <h3 className="text-sm font-bold text-slate-950">Engagement Lift Over Time</h3>
            <div className="mt-3 rounded-2xl border border-slate-200 p-4">
              <Sparkline tone="violet" className="h-24" />
              <div className="mt-2 grid grid-cols-4 text-xs text-slate-400">
                <span>May 12</span>
                <span>May 14</span>
                <span>May 16</span>
                <span className="text-right">May 18</span>
              </div>
            </div>
          </div>
        ) : isPipeline ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-950">Campaign Progress</h3>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                <StatusBadge value={campaignStatus} />
                <span>{campaignProgress} / 6</span>
                <span>{campaignLastUpdated}</span>
              </div>
            </div>
            <StageRail active={campaignStageIndex} />
          </div>
        ) : (
          <div>
            <h3 className="text-sm font-bold text-slate-950">Post Preview</h3>
            <div className="mt-3 grid overflow-hidden rounded-2xl border border-slate-200 md:grid-cols-[1.1fr_1fr]">
              <div className="grid min-h-72 place-items-center bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-8 text-center text-white">
                <div>
                  <div className="text-4xl font-black leading-none">MARKET</div>
                  <div className="text-4xl font-black leading-none">OPPORTUNITIES</div>
                  <icons.TrendingUp className="mx-auto my-7 size-20 text-emerald-400" />
                  <div className="text-4xl font-black leading-none">DO NOT WAIT</div>
                </div>
              </div>
              <div className="space-y-5 p-6 text-sm">
                <div className="flex items-center gap-3 font-bold text-slate-950">
                  <span className="grid size-8 place-items-center rounded-full bg-blue-600 text-white">f</span>
                  Facebook Post
                </div>
                <Info label="Format" value="Image" />
                <Info label="Target Audience" value="Stock traders, Investors" />
                <Info label="Tone" value="Urgent, Motivational" />
                <Info label="CTA Suggestion" value="Learn how to spot early opportunities" />
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-violet-50 p-5 text-sm leading-6 text-slate-700">
          <div className="mb-1 flex items-center gap-2 font-bold text-violet-700">
            <icons.Sparkles className="size-4" />
            Agent Note
          </div>
          {isPipeline ? campaignNextAction : "This signal is outperforming baseline campaign patterns and should be converted into a brief."}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Button>{isSignal ? "Use in Brief" : isPipeline ? "Open Campaign" : "Approve"}</Button>
          <Button variant="outline">{isSignal ? "Create Content" : "Request Change"}</Button>
          <Button variant="outline">{isSignal ? "Dismiss" : "Reject"}</Button>
        </div>
      </div>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-400">{label}</div>
      <div className="mt-1 font-medium leading-6 text-slate-700">{value}</div>
    </div>
  );
}

function StageRail({ active = 2 }: { active?: number }) {
  const stages = ["Research", "Strategy", "Content", "Approval", "Published", "Report"];
  return (
    <div className="mt-4 grid grid-cols-6 gap-2">
      {stages.map((stage, index) => (
        <div key={stage} className="text-center">
          <div className={cn("mx-auto grid size-9 place-items-center rounded-full border", index <= active ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-400")}>
            {index < active ? <icons.Check className="size-4" /> : <span className="size-2 rounded-full bg-current" />}
          </div>
          <div className={cn("mt-2 truncate text-[10px] font-semibold leading-tight", index === active ? "text-violet-700" : "text-slate-500")}>{stage}</div>
        </div>
      ))}
    </div>
  );
}

export function OverviewView({ data }: { data?: DashboardViewData }) {
  const dashboard = resolveDashboardData(data);

  return (
    <PageChrome title="CMO Engine" description="Status: Live  |  Workspace: Holdstation  |  Time range: Today">
      <div className="grid gap-6 2xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="glass-panel p-8">
          <SectionTitle icon={<icons.Sparkles />} title="Today's CMO Brief" action="View Brief" />
          <div className="mt-8 grid items-center gap-8 lg:grid-cols-[320px_1fr]">
            <div className="relative mx-auto grid size-64 place-items-center rounded-full border border-blue-100 bg-white shadow-[inset_0_0_0_16px_rgba(96,165,250,0.08),0_0_50px_rgba(99,102,241,0.16)]">
              <div className="absolute inset-8 rounded-full border-8 border-blue-200/70" />
              <icons.FileText className="size-20 text-blue-600" />
            </div>
            <div className="space-y-5">
              {[
                ["Marketing Performance", "On track to beat goals", "12%", "blue"],
                ["Top Opportunity", "Scale high-intent segments", "High", "green"],
                ["Recommended Focus", "Creative refresh in Tech US", "Open", "violet"],
              ].map(([title, desc, label, color]) => (
                <div key={title} className="flex items-center gap-4 rounded-2xl p-2 transition hover:bg-white">
                  <IconTile color={color as Tone}>
                    {color === "blue" ? <icons.TrendingUp /> : color === "green" ? <icons.Users /> : <icons.Lightbulb />}
                  </IconTile>
                  <div className="flex-1">
                    <div className="font-bold text-slate-950">{title}</div>
                    <div className="mt-1 text-sm text-slate-500">{desc}</div>
                  </div>
                  <Badge variant={color === "blue" || color === "green" ? "green" : "slate"}>{label}</Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid gap-6">
          <Card className="p-8">
            <SectionTitle icon={<icons.Clock3 />} title="Need Your Approval" color="orange" />
            <div className="mt-7 space-y-6">
              {dashboard.actions.slice(0, 2).map((action, index) => (
                <div key={action.title} className="flex items-center gap-4">
                  <IconTile color={index === 0 ? "blue" : "violet"}>{index === 0 ? <icons.Megaphone /> : <icons.PencilLine />}</IconTile>
                  <div className="flex-1">
                    <div className="font-bold text-slate-950">{action.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{action.summary.split(".")[0]}</div>
                  </div>
                  <PriorityBadge value={action.priority} />
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-8">
            <SectionTitle icon={<icons.Radio />} title="Key Signals" color="green" />
            <div className="mt-6 space-y-5">
              {["Website Visitors", "Pipeline Generated", "SQLs Created"].map((item, index) => (
                <div key={item} className="grid grid-cols-[48px_1fr_60px_120px] items-center gap-3">
                  <IconTile color={index === 0 ? "green" : index === 1 ? "blue" : "violet"} className="size-10 rounded-xl">
                    {index === 0 ? <icons.TrendingUp /> : index === 1 ? <icons.BarChart3 /> : <icons.Users />}
                  </IconTile>
                  <div className="font-semibold text-slate-950">{item}</div>
                  <Badge variant="green">+{index === 1 ? 24 : index === 0 ? 18 : 16}%</Badge>
                  <Sparkline tone="green" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
        <Card className="p-8">
          <SectionTitle icon={<icons.Target />} title="Active Campaigns" color="green" />
          <div className="mt-7 grid gap-6 md:grid-cols-3">
            {dashboard.campaigns.slice(0, 3).map((campaign) => (
              <div key={campaign.name}>
                <div className="flex items-center gap-4">
                  <CampaignMark name={campaign.name} color={campaign.tone as Tone} />
                  <div>
                    <div className="font-bold text-slate-950">{campaign.name}</div>
                    <div className="mt-1 text-sm text-slate-500">{campaign.channels}</div>
                  </div>
                </div>
                <div className="mt-6 text-sm font-semibold text-slate-500">{campaign.progress * 13}%</div>
                <MiniProgress value={campaign.progress * 13} tone="green" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-8">
          <SectionTitle icon={<icons.Bot />} title="Agent Status" color="violet" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {dashboard.agents.map((agent) => (
              <div key={agent.name} className="rounded-2xl border border-slate-200 p-4 transition hover:border-violet-200 hover:bg-violet-50/40">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-950">{agent.name}</div>
                  <StatusBadge value={agent.status} />
                </div>
                <p className="mt-2 text-sm text-slate-500">{agent.description}</p>
                <div className="mt-5">
                  <MiniProgress value={agent.progress} tone={agent.tone as "violet" | "green" | "blue" | "orange" | "pink"} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageChrome>
  );
}

export function ActionsView({ data }: { data?: DashboardViewData }) {
  const dashboard = resolveDashboardData(data);

  return (
    <PageChrome title="Action Queue" description="Tasks that need your review or approval" primary="Create Campaign">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <SegmentTabs items={[{ label: "All", count: 5 }, { label: "High", count: 1, color: "red" }, { label: "Medium", count: 3, color: "orange" }, { label: "Low", count: 1, color: "green" }]} />
        <SearchToolbar placeholder="Search actions..." />
      </div>
      <div className="grid gap-6 2xl:grid-cols-[minmax(760px,1.35fr)_minmax(430px,0.85fr)]">
        <ActionRows actions={dashboard.actions} selected />
        <DetailPanel actions={dashboard.actions} signals={dashboard.signals} mode="actions" />
      </div>
    </PageChrome>
  );
}

export function AgentsView({ data }: { data?: DashboardViewData }) {
  const dashboard = resolveDashboardData(data);

  return (
    <PageChrome title="Agent Status" description="Monitor all agents and their current activities" primary="Run All Agents">
      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard icon={<icons.Activity />} label="Running" value="2" delta="Operational" color="green" />
        <MetricCard icon={<icons.Clock3 />} label="Idle" value="1" delta="Ready" color="violet" />
        <MetricCard icon={<icons.AlertTriangle />} label="Need Review" value="1" delta="1 queue item" color="orange" />
        <MetricCard icon={<icons.X />} label="Error" value="0" delta="No incidents" color="slate" />
        <MetricCard icon={<icons.Bot />} label="Total Agents" value="4" delta="OpenClaw mesh" color="blue" />
      </div>

      <div className="grid gap-6 2xl:grid-cols-[1.35fr_0.75fr]">
        <div className="grid gap-6 lg:grid-cols-2">
          {dashboard.agents.map((agent) => (
            <Card key={agent.name} className={cn("p-6 transition hover:-translate-y-1", tone[agent.tone as Tone].border)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <IconTile color={agent.tone as Tone} className="size-14 rounded-full">
                    <icons.Bot />
                  </IconTile>
                  <div>
                    <h2 className="text-lg font-bold text-slate-950">{agent.name} ({agent.codename})</h2>
                    <p className="mt-1 text-sm text-slate-500">{agent.description}</p>
                  </div>
                </div>
                <StatusBadge value={agent.status} />
              </div>
              <p className="mt-7 text-sm text-slate-600">{agent.activity}</p>
              <div className="mt-7 flex items-center gap-5">
                <span className="text-sm font-medium text-slate-500">Progress</span>
                <MiniProgress value={agent.progress} tone={agent.tone as "violet" | "green" | "blue" | "orange" | "pink"} />
                <span className="text-sm font-bold text-slate-700">{agent.progress}%</span>
              </div>
              <div className="mt-7 grid grid-cols-4 gap-4 border-t border-slate-100 pt-5 text-sm">
                <Info label="Last run" value="12 min ago" />
                <Info label="Next run" value="In 25 min" />
                <Info label="Signal" value={agent.metricA} />
                <Info label="Output" value={agent.metricB} />
              </div>
              <Button className="mt-6 w-full justify-between" variant="outline">
                View details
                <icons.ChevronRight />
              </Button>
            </Card>
          ))}
        </div>
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <IconTile color="violet" className="size-14 rounded-full">
                <icons.PencilLine />
              </IconTile>
              <div>
                <CardTitle>Content Agent (Echo)</CardTitle>
                <StatusBadge value="Running" />
              </div>
            </div>
            <icons.X className="size-5 text-slate-400" />
          </div>
          <div className="mt-8 flex gap-8 border-b border-slate-100 text-sm font-bold">
            {["Overview", "Activity", "Output", "Settings"].map((tab, index) => (
              <span key={tab} className={cn("pb-4", index === 0 ? "border-b-2 border-violet-600 text-violet-700" : "text-slate-500")}>{tab}</span>
            ))}
          </div>
          <div className="mt-7 rounded-2xl border border-slate-200 p-5">
            <h3 className="font-bold text-slate-950">Current run</h3>
            <Badge className="mt-4">Stock Trading Campaign - Phase 1</Badge>
            <p className="mt-4 text-sm text-slate-500">Generating hooks, captions and CTA options...</p>
            <div className="mt-5 flex items-center gap-3">
              <MiniProgress value={72} />
              <span className="text-sm font-bold">72%</span>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            {["3 Drafts Ready", "3 Needs Review", "12 Generated today"].map((item, index) => (
              <div key={item} className="rounded-2xl border border-slate-200 p-4">
                <div className={cn("text-2xl font-bold", index === 1 ? "text-orange-600" : "text-slate-950")}>{item.split(" ")[0]}</div>
                <div className="mt-1 text-xs font-medium text-slate-500">{item.replace(item.split(" ")[0], "")}</div>
              </div>
            ))}
          </div>
          <h3 className="mt-8 font-bold text-slate-950">Recent activity</h3>
          <div className="mt-5 space-y-5">
            {["Generated 3 caption variations", "Created 5 hook options", "Analyzing audience response patterns", "Collected new insights from 8 sources"].map((item, index) => (
              <div key={item} className="flex items-center gap-3 text-sm">
                <span className={cn("size-2 rounded-full", index === 2 ? "bg-violet-500" : "bg-emerald-500")} />
                <span className="flex-1 text-slate-700">{item}</span>
                <span className="text-slate-400">{5 + index * 6} min ago</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </PageChrome>
  );
}

export function SignalsView({ data }: { data?: DashboardViewData }) {
  const dashboard = resolveDashboardData(data);

  return (
    <PageChrome title="Signal Feed" description="Track insights, opportunities, risks, and audience signals in real time" primary="Create Brief">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <SegmentTabs items={[{ label: "All", count: 18 }, { label: "Opportunities", count: 6, color: "green" }, { label: "Risks", count: 4, color: "red" }, { label: "Audience", count: 5, color: "blue" }, { label: "Performance", count: 3, color: "orange" }]} />
        <SearchToolbar placeholder="Search signals..." />
      </div>
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-4 md:grid-cols-5">
            <MetricCard icon={<icons.Radio />} label="Total Signals Today" value="18" delta="+20% vs yesterday" />
            <MetricCard icon={<icons.TrendingUp />} label="Opportunities" value="6" delta="+33% vs yesterday" color="green" />
            <MetricCard icon={<icons.AlertTriangle />} label="Risks" value="4" delta="-20% vs yesterday" color="red" />
            <MetricCard icon={<icons.Users />} label="Audience Signals" value="5" delta="+25% vs yesterday" color="blue" />
            <MetricCard icon={<icons.BarChart3 />} label="Avg Confidence" value="78%" delta="+8% vs yesterday" color="orange" />
          </div>
          <Card className="overflow-hidden">
            {dashboard.signals.map((signal, index) => (
              <div key={signal.title} className={cn("grid items-center gap-5 border-b border-slate-100 px-5 py-5 last:border-0 lg:grid-cols-[56px_1fr_140px_100px_100px_100px]", index === 0 && "bg-violet-50/70 ring-1 ring-inset ring-violet-300")}>
                <IconTile color={signal.severity === "High" ? "red" : signal.category === "Audience" ? "pink" : signal.category === "Performance" ? "violet" : "blue"}>
                  {signal.severity === "High" ? <icons.Flame /> : signal.category === "Audience" ? <icons.Brain /> : <icons.TrendingUp />}
                </IconTile>
                <div>
                  <div className="font-bold text-slate-950">{signal.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{signal.summary}</div>
                </div>
                <Info label="Source" value={signal.source} />
                <span className="text-sm text-slate-500">{signal.time}</span>
                <PriorityBadge value={signal.severity} />
                <Button size="sm" variant={index === 0 || signal.severity === "High" ? "default" : "outline"}>{index === 0 || signal.severity === "High" ? "Review" : "Use this"}</Button>
              </div>
            ))}
          </Card>
        </div>
        <DetailPanel actions={dashboard.actions} signals={dashboard.signals} mode="signals" />
      </div>
    </PageChrome>
  );
}

export function PipelineView({ data }: { data?: DashboardViewData }) {
  const dashboard = resolveDashboardData(data);

  return (
    <PageChrome title="Campaign Pipeline" description="Track campaigns from research to reporting">
      <div className="flex justify-end">
        <SearchToolbar placeholder="Search campaigns..." />
      </div>
      <Card className="p-7">
        <div className="grid items-center gap-4 md:grid-cols-6">
          {[
            ["Research", 6, "green"],
            ["Strategy", 4, "blue"],
            ["Content", 9, "violet"],
            ["Approval", 3, "orange"],
            ["Published", 8, "green"],
            ["Report", 5, "blue"],
          ].map(([stage, count, color], index) => (
            <div key={stage} className="relative text-center">
              {index < 5 && <div className="absolute left-1/2 top-8 hidden h-px w-full bg-slate-200 md:block" />}
              <IconTile color={color as Tone} className="relative mx-auto size-16 rounded-full">
                {index === 0 ? <icons.Search /> : index === 1 ? <icons.Workflow /> : index === 2 ? <icons.PencilLine /> : index === 3 ? <icons.ShieldCheck /> : index === 4 ? <icons.Send /> : <icons.BarChart3 />}
              </IconTile>
              <div className="mt-4 font-bold text-slate-950">{stage}</div>
              <Badge className="mt-2" variant={color === "orange" ? "orange" : color === "green" ? "green" : color === "blue" ? "blue" : "default"}>{count}</Badge>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-6 2xl:grid-cols-[1.35fr_0.75fr]">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-5">
            <MetricCard icon={<icons.Folder />} label="Total Campaigns" value="35" delta="+15% vs 7 days" color="violet" />
            <MetricCard icon={<icons.ShieldCheck />} label="Need Approval" value="3" delta="2 high priority" color="orange" />
            <MetricCard icon={<icons.Activity />} label="In Progress" value="19" delta="54% of total" color="blue" />
            <MetricCard icon={<icons.Send />} label="Published This Week" value="8" delta="+33% vs last week" color="green" />
            <MetricCard icon={<icons.TrendingUp />} label="Completion Rate" value="76%" delta="+12% vs last week" />
          </div>
          <CampaignTable campaigns={dashboard.campaigns} />
        </div>
        <div className="min-w-0">
          <DetailPanel actions={dashboard.actions} signals={dashboard.signals} selectedCampaign={dashboard.campaigns[0]} mode="pipeline" />
        </div>
      </div>
    </PageChrome>
  );
}

function CampaignTable({ campaigns }: { campaigns: ReturnType<typeof resolveDashboardData>["campaigns"] }) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[minmax(210px,1fr)_96px_130px_116px_132px_88px_24px] gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-4 text-xs font-semibold text-slate-500 max-xl:hidden">
        <span>Campaign</span><span>Stage</span><span>Owner Agent</span><span>Status</span><span>Progress</span><span>Last Updated</span><span />
      </div>
      {campaigns.map((campaign, index) => (
        <div key={campaign.name} className={cn("grid items-center gap-3 border-b border-slate-100 px-5 py-4 last:border-0 xl:grid-cols-[minmax(210px,1fr)_96px_130px_116px_132px_88px_24px]", index === 0 && "bg-violet-50/70 ring-1 ring-inset ring-violet-300")}>
          <div className="flex items-center gap-4">
            <CampaignMark name={campaign.name} color={campaign.tone as Tone} />
            <div>
              <div className="font-bold text-slate-950">{campaign.name}</div>
              <div className="mt-1 text-sm text-slate-500">{campaign.channels}</div>
            </div>
          </div>
          <Badge variant={campaign.stage === "Approval" ? "orange" : campaign.stage === "Published" ? "green" : campaign.stage === "Report" ? "blue" : "default"}>{campaign.stage}</Badge>
          <div className="text-sm text-slate-600"><span className="font-semibold text-slate-950">{campaign.owner}</span><br />{campaign.agent}</div>
          <StatusBadge value={campaign.status} />
          <div>
            <div className="mb-1 text-center text-xs font-semibold text-slate-500">{campaign.progress} / 6</div>
            <MiniProgress value={(campaign.progress / 6) * 100} tone={campaign.tone as "violet" | "green" | "blue" | "orange" | "pink"} />
          </div>
          <span className="text-sm text-slate-500">{campaign.updated}</span>
          <icons.ChevronRight className="size-4 text-slate-400" />
        </div>
      ))}
    </Card>
  );
}

export function ReportsView({ data }: { data?: DashboardViewData }) {
  const dashboard = resolveDashboardData(data);

  return (
    <PageChrome title="Recent Reports" description="All reports generated by CMO Engine and agents" primary="New Brief">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <SegmentTabs items={[{ label: "All Reports", count: 24 }, { label: "Daily", count: 7, color: "blue" }, { label: "Weekly", count: 8, color: "green" }, { label: "Monthly", count: 5, color: "orange" }, { label: "Custom", count: 4, color: "slate" }]} />
        <div className="flex gap-3">
          <SearchToolbar placeholder="Search reports..." />
          <Button variant="outline" size="icon"><icons.Grid2X2 /></Button>
          <Button variant="outline" size="icon"><icons.List /></Button>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-4">
        {dashboard.reports.map((report) => (
          <Card key={report.title} className="p-6 transition hover:-translate-y-1 hover:border-violet-200 hover:shadow-[0_24px_70px_rgba(15,23,42,0.1)]">
            <div className="flex items-start justify-between">
              <IconTile color={report.tone as Tone}>{report.tone === "green" ? <icons.TrendingUp /> : report.tone === "orange" ? <icons.Users /> : report.tone === "pink" ? <icons.Target /> : <icons.FileText />}</IconTile>
              <Badge variant={report.tone === "green" ? "green" : report.tone === "orange" ? "orange" : report.tone === "pink" ? "pink" : report.tone === "blue" ? "blue" : "default"}>{report.type}</Badge>
            </div>
            <h2 className="mt-6 text-xl font-bold text-slate-950">{report.title}</h2>
            <p className="mt-3 text-sm text-slate-500">{report.meta}</p>
            <p className="mt-4 min-h-12 text-sm leading-6 text-slate-600">
              {report.title.includes("Performance") ? "Performance overview for all campaigns, content, and channels." : report.title.includes("Executive") ? "AI-generated executive summary with next actions." : "Full summary with key signals, insights, and recommendations."}
            </p>
            <div className="my-5 h-px bg-slate-100" />
            <div className="grid grid-cols-3 gap-3 text-sm">
              {report.stats.map((stat, index) => (
                <div key={`${report.title}-${stat}`}>
                  <div className="text-xs font-semibold text-slate-500">{["Signals", "Insights", "Actions"][index]}</div>
                  <div className="mt-1 font-bold text-slate-950">{stat}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-3">
              <Button variant="outline" size="sm">View Report</Button>
              <Button variant="outline" size="icon" className="ml-auto"><icons.Download /></Button>
              <Button variant="outline" size="icon"><icons.MoreHorizontal /></Button>
            </div>
          </Card>
        ))}
      </div>
      <div className="flex justify-center">
        <Button variant="outline">View all reports <icons.ChevronDown /></Button>
      </div>
    </PageChrome>
  );
}

export function VaultView({ data }: { data?: DashboardViewData }) {
  const dashboard = resolveDashboardData(data);

  return (
    <PageChrome title="Vault" description="Secure OpenClaw memory, brand knowledge, approvals, and reusable campaign intelligence" primary="Index Memory">
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="glass-panel p-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
            <div className="relative grid size-56 shrink-0 place-items-center rounded-[2rem] border border-violet-100 bg-white shadow-[inset_0_0_0_18px_rgba(139,92,246,0.07),0_30px_80px_rgba(99,102,241,0.16)]">
              <icons.LockKeyhole className="size-20 text-violet-600" />
              <span className="absolute right-8 top-8 size-3 rounded-full bg-emerald-500 shadow-[0_0_0_8px_rgba(16,185,129,0.12)]" />
            </div>
            <div className="max-w-2xl">
              <Badge>OpenClaw Memory Layer</Badge>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-950">Enterprise knowledge ready for agent orchestration</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                Vault keeps brand policies, campaign learnings, approved decisions, and integration context indexed for every marketing agent.
              </p>
              <div className="mt-7 grid gap-4 sm:grid-cols-3">
                <MetricMini label="Indexed Memories" value="1,248" />
                <MetricMini label="Fresh Signals" value="47" />
                <MetricMini label="Review Items" value="12" />
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-8">
          <SectionTitle icon={<icons.Database />} title="Vault Health" color="blue" action="Audit" />
          <div className="mt-7 space-y-5">
            {[
              ["Brand policy coverage", 92, "violet"],
              ["Campaign memory freshness", 86, "green"],
              ["Approval traceability", 78, "blue"],
              ["Sensitive context protection", 98, "orange"],
            ].map(([label, value, color]) => (
              <div key={label as string}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-700">{label}</span>
                  <span className="font-bold text-slate-950">{value}%</span>
                </div>
                <MiniProgress value={value as number} tone={color as "violet" | "green" | "blue" | "orange"} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
        {dashboard.vault.map((item) => (
          <Card key={item.name} className="p-6 transition hover:-translate-y-1 hover:border-violet-200">
            <div className="flex items-start justify-between gap-4">
              <IconTile color={item.tone as Tone}>
                {item.name.includes("Secret") ? <icons.KeyRound /> : item.name.includes("Archive") ? <icons.Archive /> : item.name.includes("Guardrails") ? <icons.ShieldCheck /> : item.name.includes("Creative") ? <icons.Folder /> : <icons.Database />}
              </IconTile>
              <StatusBadge value={item.status} />
            </div>
            <h2 className="mt-6 text-xl font-bold text-slate-950">{item.name}</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">{item.type}</p>
            <div className="mt-6 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <span className="text-sm text-slate-500">Scope</span>
              <span className="text-sm font-bold text-slate-950">{item.count}</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button variant="outline" size="sm">Open</Button>
              <Button variant="soft" size="sm">Sync</Button>
            </div>
          </Card>
        ))}
      </div>
    </PageChrome>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-2xl font-bold text-slate-950">{value}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{label}</div>
    </div>
  );
}
