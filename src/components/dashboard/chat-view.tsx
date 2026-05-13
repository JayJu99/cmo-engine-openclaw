"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import type { CmoChatRun, CmoChatRunIndexItem, CmoChatRunListResponse } from "@/lib/cmo/types";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: CmoChatRun["status"];
};

export type ChatContextPreview = {
  type: "action" | "signal" | "campaign";
  title: string;
  meta?: string;
};

type ChatViewProps = {
  initialQuestion?: string;
  initialContext?: ChatContextPreview | null;
};

const POLL_INTERVAL_MS = 4_000;
const MAX_POLLS = 45;
const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Ask a practical CMO question. I will use the latest dashboard context when it is available.",
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
    const message = typeof record?.error === "string" ? record.error : "CMO chat request failed";

    throw new Error(message);
  }

  return payload as T;
}

function isTerminalStatus(status: CmoChatRun["status"]) {
  return status === "completed" || status === "failed" || status === "timeout";
}

function statusLabel(status: CmoChatRun["status"] | undefined) {
  if (status === "running") {
    return "Thinking";
  }

  if (status === "completed") {
    return "Completed";
  }

  if (status === "timeout") {
    return "Timed out";
  }

  if (status === "failed") {
    return "Failed";
  }

  return "Ready";
}

function statusClass(status: CmoChatRun["status"]) {
  if (status === "completed") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }

  if (status === "running") {
    return "bg-blue-50 text-blue-700 ring-blue-100";
  }

  if (status === "timeout") {
    return "bg-orange-50 text-orange-700 ring-orange-100";
  }

  return "bg-red-50 text-red-700 ring-red-100";
}

function displayDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messagesFromRun(chatRun: CmoChatRun): ChatMessage[] {
  return [
    {
      id: `user_${chatRun.chat_run_id}`,
      role: "user",
      content: chatRun.question,
    },
    {
      id: `assistant_${chatRun.chat_run_id}`,
      role: "assistant",
      status: chatRun.status,
      content:
        chatRun.answer ||
        chatRun.error?.message ||
        (chatRun.status === "running" ? "CMO is preparing a concise answer..." : "No answer was returned."),
    },
  ];
}

export function ChatView({ initialQuestion = "", initialContext = null }: ChatViewProps) {
  const router = useRouter();
  const [input, setInput] = useState(initialQuestion);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [history, setHistory] = useState<CmoChatRunIndexItem[]>([]);
  const [activeContext, setActiveContext] = useState<ChatContextPreview | null>(initialContext);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCount = useRef(0);
  const messageCounter = useRef(0);

  const clearPollTimer = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearPollTimer();
  }, [clearPollTimer]);

  const refreshHistory = useCallback(async () => {
    setIsHistoryLoading(true);

    try {
      const response = await readJsonResponse<CmoChatRunListResponse>(await fetch("/api/cmo/chat?limit=20", { cache: "no-store" }));
      setHistory(response.data);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "CMO chat history failed to load");
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshHistory();
    }, 0);

    return () => clearTimeout(timer);
  }, [refreshHistory]);

  function nextMessageId(prefix: string) {
    messageCounter.current += 1;
    return `${prefix}_${messageCounter.current}`;
  }

  function updateAssistantMessage(messageId: string, chatRun: CmoChatRun) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              status: chatRun.status,
              content:
                chatRun.answer ||
                chatRun.error?.message ||
                (chatRun.status === "running" ? "CMO is preparing a concise answer..." : "No answer was returned."),
            }
          : message,
      ),
    );
  }

  function resetChat() {
    clearPollTimer();
    pollCount.current = 0;
    setInput("");
    setActiveContext(null);
    setMessages([welcomeMessage]);
    setSelectedRunId(null);
    setActiveRunId(null);
    setIsLoading(false);
    setError(null);
    router.replace("/chat");
  }

  async function loadChat(chatRunId: string) {
    clearPollTimer();
    setError(null);
    setIsLoading(true);
    setSelectedRunId(chatRunId);
    setActiveRunId(null);

    try {
      const chatRun = await readJsonResponse<CmoChatRun>(await fetch(`/api/cmo/chat/${encodeURIComponent(chatRunId)}`, { cache: "no-store" }));
      const assistantMessageId = `assistant_${chatRun.chat_run_id}`;

      setMessages(messagesFromRun(chatRun));

      if (chatRun.status === "running") {
        setActiveRunId(chatRun.chat_run_id);
        pollCount.current = 0;
        pollTimer.current = setTimeout(() => {
          void pollChat(chatRun.chat_run_id, assistantMessageId);
        }, POLL_INTERVAL_MS);
        return;
      }

      setIsLoading(false);

      if (chatRun.status !== "completed") {
        setError(chatRun.error?.message ?? `CMO chat ${chatRun.status}`);
      }

      await refreshHistory();
    } catch (loadError) {
      setSelectedRunId(null);
      setIsLoading(false);
      setError(loadError instanceof Error ? loadError.message : "CMO chat failed to load");
    }
  }

  async function pollChat(chatRunId: string, assistantMessageId: string) {
    clearPollTimer();

    try {
      const chatRun = await readJsonResponse<CmoChatRun>(await fetch(`/api/cmo/chat/${encodeURIComponent(chatRunId)}`, { cache: "no-store" }));

      updateAssistantMessage(assistantMessageId, chatRun);

      if (isTerminalStatus(chatRun.status)) {
        setActiveRunId(null);
        setIsLoading(false);
        setSelectedRunId(chatRun.chat_run_id);
        await refreshHistory();

        if (chatRun.status !== "completed") {
          setError(chatRun.error?.message ?? `CMO chat ${chatRun.status}`);
        }

        return;
      }

      pollCount.current += 1;

      if (pollCount.current >= MAX_POLLS) {
        setActiveRunId(null);
        setIsLoading(false);
        setError("CMO chat timed out in the browser. Check the run again from the adapter logs.");
        return;
      }

      pollTimer.current = setTimeout(() => {
        void pollChat(chatRunId, assistantMessageId);
      }, POLL_INTERVAL_MS);
    } catch (pollError) {
      setActiveRunId(null);
      setIsLoading(false);
      setError(pollError instanceof Error ? pollError.message : "CMO chat polling failed");
    }
  }

  async function sendMessage() {
    const question = input.trim();

    if (!question || isLoading) {
      return;
    }

    clearPollTimer();
    setError(null);
    setInput("");
    setIsLoading(true);

    const userMessageId = nextMessageId("user");
    const assistantMessageId = nextMessageId("assistant");

    setMessages((current) => [
      ...current,
      { id: userMessageId, role: "user", content: question },
      { id: assistantMessageId, role: "assistant", content: "CMO is preparing a concise answer...", status: "running" },
    ]);

    try {
      const chatRun = await readJsonResponse<CmoChatRun>(
        await fetch("/api/cmo/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question }),
        }),
      );

      updateAssistantMessage(assistantMessageId, chatRun);
      setActiveRunId(chatRun.chat_run_id);
      setSelectedRunId(chatRun.chat_run_id);
      await refreshHistory();

      if (isTerminalStatus(chatRun.status)) {
        setIsLoading(false);
        setActiveRunId(null);
        await refreshHistory();

        if (chatRun.status !== "completed") {
          setError(chatRun.error?.message ?? `CMO chat ${chatRun.status}`);
        }

        return;
      }

      pollCount.current = 0;
      pollTimer.current = setTimeout(() => {
        void pollChat(chatRun.chat_run_id, assistantMessageId);
      }, POLL_INTERVAL_MS);
    } catch (sendError) {
      setActiveRunId(null);
      setIsLoading(false);
      setError(sendError instanceof Error ? sendError.message : "CMO chat failed to start");
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                status: "failed",
                content: "CMO chat failed to start.",
              }
            : message,
        ),
      );
    }
  }

  return (
    <PageChrome title="CMO Chat" description="Ask the CMO agent direct questions using the latest dashboard context" primary="New Chat" onPrimaryClick={resetChat}>
      <Card className="grid min-h-[calc(100vh-220px)] overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-h-[620px] flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                <icons.MessageSquare />
              </div>
              <div>
                <div className="font-bold text-slate-950">CMO Direct</div>
                <div className="text-xs font-medium text-slate-500">
                  {activeRunId ? `Run ${activeRunId}` : selectedRunId ? `Viewing ${selectedRunId}` : statusLabel(isLoading ? "running" : undefined)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
              <span className={cn("size-2 rounded-full", isLoading ? "bg-blue-500" : error ? "bg-red-500" : "bg-emerald-500")} />
              {isLoading ? "Running" : error ? "Needs review" : "Ready"}
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-5">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[820px] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm",
                    message.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700",
                  )}
                >
                  {message.role === "assistant" ? (
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-indigo-700">
                      <icons.Sparkles className="size-4" />
                      {statusLabel(message.status)}
                    </div>
                  ) : null}
                  <div className="whitespace-pre-wrap">{message.content}</div>
                </div>
              </div>
            ))}
          </div>

          {error ? (
            <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          ) : null}

          <div className="border-t border-slate-100 bg-white p-4">
            {activeContext ? (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm">
                <span className="rounded-lg bg-white px-2 py-1 text-xs font-bold uppercase text-indigo-700 ring-1 ring-indigo-100">
                  {activeContext.type}
                </span>
                <span className="font-bold text-slate-950">{activeContext.title}</span>
                {activeContext.meta ? <span className="text-xs font-semibold text-slate-500">{activeContext.meta}</span> : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-3 md:flex-row">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Ask about priorities, campaigns, signals, or next actions..."
                className="min-h-24 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
                disabled={isLoading}
              />
              <Button className="h-12 md:self-end" onClick={() => void sendMessage()} disabled={!input.trim() || isLoading}>
                {isLoading ? <icons.RefreshCw className="animate-spin" /> : <icons.Send />}
                Send
              </Button>
            </div>
          </div>
        </section>

        <aside className="border-t border-slate-100 bg-white p-5 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                <icons.Clock3 />
              </div>
              <div>
                <div className="font-bold text-slate-950">Recent Chats</div>
                <div className="text-xs font-medium text-slate-500">{isHistoryLoading ? "Loading..." : `${history.length} saved`}</div>
              </div>
            </div>
            <Button variant="outline" size="icon" onClick={() => void refreshHistory()} aria-label="Refresh chat history">
              <icons.RefreshCw className={cn(isHistoryLoading && "animate-spin")} />
            </Button>
          </div>
          <div className="mt-5 max-h-80 space-y-3 overflow-y-auto pr-1">
            {history.length ? (
              history.map((chat) => (
                <button
                  key={chat.chat_run_id}
                  onClick={() => void loadChat(chat.chat_run_id)}
                  className={cn(
                    "w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50",
                    selectedRunId === chat.chat_run_id && "border-indigo-200 bg-indigo-50 ring-1 ring-indigo-100",
                  )}
                >
                  <div className="max-h-10 overflow-hidden text-sm font-bold leading-5 text-slate-900">{chat.question || "Untitled chat"}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-lg px-2 py-0.5 text-[11px] font-bold ring-1", statusClass(chat.status))}>{chat.status}</span>
                    <span className="text-[11px] font-medium text-slate-500">{displayDate(chat.created_at)}</span>
                  </div>
                  <div className="mt-2 truncate text-[11px] font-medium text-slate-500">
                    Context: {chat.context_run_id ?? "none"}
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                No saved chats yet.
              </div>
            )}
          </div>

          <div className="my-6 h-px bg-slate-100" />

          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <icons.Database />
            </div>
            <div>
              <div className="font-bold text-slate-950">Context Sources</div>
              <div className="text-xs font-medium text-slate-500">Latest run, if available</div>
            </div>
          </div>
          <div className="mt-5 space-y-3 text-sm">
            {["Summary", "Actions", "Signals", "Campaigns", "Vault"].map((item) => (
              <div key={item} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                <span className="font-semibold text-slate-700">{item}</span>
                <icons.CheckCircle2 className="size-4 text-emerald-600" />
              </div>
            ))}
          </div>
        </aside>
      </Card>
    </PageChrome>
  );
}
