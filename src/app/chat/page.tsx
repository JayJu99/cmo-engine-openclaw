import { ChatView, type ChatContextPreview } from "@/components/dashboard/chat-view";
import { readDashboardLatestRun, readDashboardRun } from "@/lib/cmo/adapter";
import type { CmoRun } from "@/lib/cmo/types";

export const dynamic = "force-dynamic";

type ChatPageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function contextMeta(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part)).join(" / ");
}

function resolveContextFromRun(run: CmoRun, intent: string, id: string): { question: string; context: ChatContextPreview } | null {
  if (intent === "run") {
    return {
      question: "Review this CMO run and tell me what changed, what matters most, and what I should do next.",
      context: {
        type: "run",
        title: run.summary.title,
        status: run.status,
        createdAt: run.created_at,
        contextRunId: run.run_id,
      },
    };
  }

  if (intent === "action") {
    const action = run.actions.find((item) => item.id === id);

    return action
      ? {
          question: `Explain this action and recommend the next 3 concrete steps: ${action.title}`,
          context: {
            type: "action",
            title: action.title,
            meta: contextMeta([action.source, action.priority]),
          },
        }
      : null;
  }

  if (intent === "signal") {
    const signal = run.signals.find((item) => item.id === id);

    return signal
      ? {
          question: `Analyze this signal and tell me what campaign/content decision it should affect: ${signal.title}`,
          context: {
            type: "signal",
            title: signal.title,
            meta: contextMeta([signal.source, signal.severity]),
          },
        }
      : null;
  }

  if (intent === "campaign") {
    const campaign = run.campaigns.find((item) => item.id === id);

    return campaign
      ? {
          question: `Review this campaign and tell me what to approve, change, or block next: ${campaign.name}`,
          context: {
            type: "campaign",
            title: campaign.name,
            meta: contextMeta([campaign.stage, campaign.status]),
          },
        }
      : null;
  }

  return null;
}

function fallbackContext(intent: string, id = ""): ChatContextPreview | null {
  return intent === "run"
    ? {
        type: "run",
        title: "Selected CMO run",
        meta: "Run detail not found",
        ...(id ? { contextRunId: id } : {}),
      }
    : intent === "action" || intent === "signal" || intent === "campaign"
      ? {
          type: intent,
          title: "Dashboard context",
          meta: "Item not found in latest run",
        }
      : null;
}

function fallbackQuestion(intent: string, id: string) {
  if (intent === "run") {
    return "Review this CMO run and tell me what changed, what matters most, and what I should do next.";
  }

  if (intent === "action") {
    return `Explain this action and recommend the next 3 concrete steps: ${id || "selected action"}`;
  }

  if (intent === "signal") {
    return `Analyze this signal and tell me what campaign/content decision it should affect: ${id || "selected signal"}`;
  }

  if (intent === "campaign") {
    return `Review this campaign and tell me what to approve, change, or block next: ${id || "selected campaign"}`;
  }

  return "";
}

export default async function ChatPage({ searchParams }: { searchParams: ChatPageSearchParams }) {
  const params = await searchParams;
  const questionParam = firstParam(params.question).trim();
  const intent = firstParam(params.intent).trim();
  const id = firstParam(params.id).trim();
  let initialQuestion = questionParam;
  let initialContext = fallbackContext(intent, id);

  if (intent && id) {
    try {
      const contextRun = intent === "run" ? await readDashboardRun(id) : await readDashboardLatestRun();
      const resolved = contextRun ? resolveContextFromRun(contextRun, intent, id) : null;

      if (resolved) {
        initialQuestion = resolved.question;
        initialContext = resolved.context;
      }
    } catch {
      initialContext = fallbackContext(intent, id);
    }

    if (!initialQuestion) {
      initialQuestion = fallbackQuestion(intent, id);
    }
  }

  return <ChatView key={`${intent}:${id}:${initialQuestion}`} initialQuestion={initialQuestion} initialContext={initialContext} />;
}
