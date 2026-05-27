import type { CMOAppChatRequest, CMOAppChatResponse } from "@/lib/cmo/app-workspace-types";
import { isReviewAuditIntent } from "@/lib/cmo/app-routing-intent";
import { executeHermesEcho, isHermesExecutionEnabled, type HermesEchoBrief } from "@/lib/cmo/hermes-client";

interface EchoBridgeResult {
  handled: boolean;
  response?: Pick<CMOAppChatResponse, "answer" | "assumptions" | "suggestedActions" | "runtimeProvider" | "runtimeAgent" | "isRuntimeFallback" | "runtimeError">;
}

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}


function parseDirectEchoCommand(message: string): string | null {
  const trimmed = message.trim();
  const match = trimmed.match(/^(?:\/echo|@echo)(?:\s+([\s\S]*))?$/i);

  if (!match) {
    return null;
  }

  return (match[1] ?? "").trim();
}

function inferTone(message: string): string | undefined {
  const toneMatch = message.match(/tone\s*[:=-]\s*([^\n.]+)/i);

  return toneMatch?.[1]?.trim();
}

function buildDirectEchoBrief(request: CMOAppChatRequest, objective: string): HermesEchoBrief {
  return {
    handoff_id: `direct_echo_${Date.now()}`,
    source_agent: "jay",
    target_agent: "echo",
    mode: "direct_jay",
    workspace: "holdstation-mini-app",
    task_type: "direct_content_task",
    objective,
    platform: platformFromMessage(objective) ?? "unknown",
    tone: inferTone(objective) ?? "direct Jay request",
    source_context: {
      raw_request: objective,
      origin: "cmo_engine_direct_echo_command",
    },
    constraints: [
      "Do not invent unsupported metrics",
      "Do not publish",
      "Do not update Vault/App Memory/tasks",
    ],
    return_to: "cmo_engine",
    max_turns: 1,
  };
}

function directEchoUnavailableAnswer(reason: string, brief: HermesEchoBrief): string {
  return [
    "## Agent Execution",
    "",
    "- Echo unavailable in Direct Jay Mode.",
    "- CMO was not invoked for strategic decisioning.",
    "",
    "## Echo Output",
    "",
    "No Echo output was produced.",
    "",
    "## Optional Notes",
    "",
    `- Blocker: ${reason}`,
    "- No fallback CMO copy was generated. Ask `CMO, bypass Echo...` if you explicitly want a temporary CMO draft.",
    "",
    "## Echo Brief",
    "",
    echoBriefMarkdown(brief),
  ].join("\n");
}

function explicitBypass(message: string): boolean {
  return /\b(echo bypass|bypass echo|temporary cmo draft|cmo draft only|skip echo)\b/i.test(message);
}

function platformFromMessage(message: string): string | null {
  const text = normalized(message);

  if (/\b(x|twitter)\b/.test(text)) return "X";
  if (/\blinkedin\b/.test(text)) return "LinkedIn";
  if (/\bfacebook|\bfb\b/.test(text)) return "Facebook";
  if (/\btelegram\b/.test(text)) return "Telegram";
  if (/\bdiscord\b/.test(text)) return "Discord";

  return null;
}

function isFinalContentAsset(message: string): boolean {
  if (isReviewAuditIntent(message)) return false;
  const text = normalized(message);
  const contentIntent = /\b(write|draft|create|generate|compose|final|copy|post|thread|caption|content|tweet)\b/.test(text);
  const asset = /\b(post|posts|thread|caption|copy|tweet|x post|facebook post|linkedin post|announcement)\b/.test(text);

  return contentIntent && asset;
}

function isStrategicOnly(message: string): boolean {
  const text = normalized(message);

  if (isFinalContentAsset(message)) {
    return false;
  }

  return /\b(strategy|strategic|recommend|plan|priority|angle|positioning|what should|next step|analyze|review)\b/.test(text);
}

function deliverableForPlatform(platform: string) {
  if (platform === "X") {
    return { taskType: "x_post_draft", format: "3 X posts", count: 3, maxLength: "platform appropriate" };
  }

  return { taskType: `${platform.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_draft`, format: `3 ${platform} drafts`, count: 3, maxLength: "platform appropriate" };
}

export function echoBriefMarkdown(brief: HermesEchoBrief): string {
  return [
    `handoff_id: ${brief.handoff_id}`,
    `target_agent: ${brief.target_agent}`,
    `workspace: ${brief.workspace}`,
    `task_type: ${brief.task_type}`,
    `platform: ${brief.platform}`,
    `audience: ${brief.audience}`,
    `objective: ${brief.objective}`,
    ...(brief.tone ? [`tone: ${brief.tone}`] : []),
    ...(brief.deliverable ? [`deliverable: ${brief.deliverable.format}`] : []),
    "constraints:",
    ...brief.constraints.map((constraint) => `- ${constraint}`),
  ].join("\n");
}

function buildEchoBrief(request: CMOAppChatRequest, platform: string): HermesEchoBrief {
  const deliverable = deliverableForPlatform(platform);

  return {
    handoff_id: `cmo_echo_${Date.now()}`,
    source_agent: "cmo",
    target_agent: "echo",
    workspace: "holdstation-mini-app",
    task_type: deliverable.taskType,
    objective: request.message,
    platform,
    audience: "crypto-native Holdstation Mini App users and prospects",
    source_context: {
      metrics_source: "Dune / Worldchain",
      allowed_metrics: [],
      claim_constraints: [],
      raw_request: request.message,
    },
    tone: "sharp, crypto-native, non-corporate",
    deliverable: {
      format: deliverable.format,
      count: deliverable.count,
      max_length: deliverable.maxLength,
    },
    constraints: [
      "Do not invent unsupported metrics",
      "Do not claim campaign results",
      "Do not change strategy",
      "Do not publish",
    ],
    return_to: "cmo_engine",
    max_turns: 1,
  };
}

function unavailableAnswer(title: string, reason: string, brief: HermesEchoBrief): string {
  return [
    "## Agent Execution",
    "Echo unavailable",
    "",
    `Failure reason: ${reason}`,
    "",
    "## Echo Brief",
    "",
    echoBriefMarkdown(brief),
    "",
    "## Blocker",
    "",
    title,
    "",
    "## Next action",
    "",
    "Enable/recover Hermes Echo execution, then retry. CMO will not silently write replacement copy.",
  ].join("\n");
}


export function isMixedCmoEchoRequest(message: string): boolean {
  if (isReviewAuditIntent(message)) return false;
  const text = normalized(message);

  if (parseDirectEchoCommand(message) !== null) {
    return false;
  }

  const mentionsEcho = /@echo\b/i.test(message);
  const asksForCmoJudgment = /\b(strategy|strategic|analyse|analyze|analysis|diagnosis|decision|plan|recommend|recommendation|campaign|direction|positioning|priorit|judgment|phan tich|chien luoc|chien dịch|quyet dinh|dinh huong)\b/.test(text);

  return mentionsEcho && asksForCmoJudgment;
}

export function mixedEchoNeedsClarification(message: string): boolean {
  const text = normalized(message);

  return /\b(chua ro|not sure|unclear|missing|need context|need info|khong ro|khong chac)\b/.test(text);
}

export function buildMixedCmoEchoRuntimeMessage(message: string): string {
  return [
    message,
    "",
    "CMO orchestration instruction:",
    "- Treat @Echo as a specialist execution request, not as Direct Jay Mode.",
    "- CMO must provide strategy/diagnosis/decision first.",
    "- Do not write final copy yourself; prepare a clear Echo Brief for a final-copy specialist.",
    "- Include these sections in your answer: Strategic Read, Diagnosis, Decision, Echo Brief, Next Actions.",
    "- If critical goal/source/audience/context is missing, ask clarification and do not prepare final copy.",
  ].join("\n");
}

export function buildMixedEchoBriefFromCmoAnswer(request: CMOAppChatRequest, cmoAnswer: string): HermesEchoBrief {
  const objective = request.message.replace(/@echo/gi, "Echo").trim();

  return {
    handoff_id: `cmo_orchestrated_echo_${Date.now()}`,
    source_agent: "cmo",
    target_agent: "echo",
    workspace: "holdstation-mini-app",
    task_type: "cmo_orchestrated_content_task",
    objective,
    platform: platformFromMessage(request.message) ?? "unknown",
    audience: "crypto-native Holdstation Mini App users and prospects",
    source_context: {
      metrics_source: "CMO strategic read",
      allowed_metrics: [],
      claim_constraints: [],
      raw_request: request.message,
      origin: "cmo_engine_cmo_orchestrated_echo",
    },
    tone: inferTone(request.message) ?? "follow CMO strategic direction",
    deliverable: {
      format: "final content copy requested by CMO brief",
      count: 3,
      max_length: "platform appropriate",
    },
    constraints: [
      "Follow the CMO strategy and Echo Brief only",
      "Do not make strategy decisions",
      "Do not invent unsupported metrics",
      "Do not publish",
      "Do not update Vault/App Memory/tasks",
      "CMO strategic output follows below:\n" + cmoAnswer,
    ],
    return_to: "cmo_engine",
    max_turns: 1,
  };
}

export async function executeMixedCmoEcho(request: CMOAppChatRequest, cmoAnswer: string): Promise<Pick<CMOAppChatResponse, "answer" | "assumptions" | "suggestedActions" | "runtimeProvider" | "runtimeAgent" | "isRuntimeFallback" | "runtimeError">> {
  const brief = buildMixedEchoBriefFromCmoAnswer(request, cmoAnswer);
  const result = await executeHermesEcho(brief);

  if (!result.ok || !result.response) {
    const reason = result.failureReason ?? "Hermes Echo execution failed.";

    return {
      answer: [
        cmoAnswer,
        "",
        "## Agent Execution",
        "",
        "- Echo unavailable for CMO-orchestrated execution.",
        "- CMO did not silently write replacement final copy.",
        "",
        "## Echo Brief",
        "",
        echoBriefMarkdown(brief),
        "",
        "## Optional Notes",
        "",
        `- Blocker: ${reason}`,
      ].join("\n"),
      assumptions: [],
      suggestedActions: [{ type: "cmo_echo_retry", label: "Recover Hermes Echo and retry CMO-orchestrated execution." }],
      runtimeProvider: "hermes",
      runtimeAgent: "echo",
      isRuntimeFallback: true,
      runtimeError: reason,
    };
  }

  return {
    answer: [
      cmoAnswer,
      "",
      "## Agent Execution",
      "",
      "- Echo used for final content copy.",
      "",
      "## CMO Review",
      "",
      "- Echo executed from the CMO strategic direction; Echo did not make strategy decisions.",
      "",
      "## Echo Output",
      "",
      ...result.response.outputs.flatMap((output) => [`### ${output.label}`, output.copy, ""]),
      ...(result.response.notes.length ? ["## Optional Notes", "", ...result.response.notes.map((note) => `- ${note}`)] : []),
    ].join("\n").trim(),
    assumptions: [],
    suggestedActions: [{ type: "cmo_echo_completed", label: "Review CMO strategy and Echo output." }],
    runtimeProvider: "hermes",
    runtimeAgent: "echo",
    isRuntimeFallback: false,
  };
}

export async function maybeHandleEchoBridge(request: CMOAppChatRequest): Promise<EchoBridgeResult> {
  const directEchoObjective = parseDirectEchoCommand(request.message);

  if (directEchoObjective !== null) {
    if (!directEchoObjective) {
      return {
        handled: true,
        response: {
          answer: [
            "## Agent Execution",
            "",
            "- Direct Echo command detected.",
            "- CMO was not invoked for strategic decisioning.",
            "",
            "## Echo Output",
            "",
            "Please add the content task after `/echo` or `@echo`.",
          ].join("\n"),
          assumptions: [],
          suggestedActions: [{ type: "direct_echo_empty", label: "Provide the content task for Echo." }],
          runtimeProvider: "hermes",
          runtimeAgent: "echo",
          isRuntimeFallback: false,
        },
      };
    }

    const brief = buildDirectEchoBrief(request, directEchoObjective);
    const result = await executeHermesEcho(brief);

    if (!result.ok || !result.response) {
      const reason = result.failureReason ?? "Hermes Echo execution failed.";

      return {
        handled: true,
        response: {
          answer: directEchoUnavailableAnswer(reason, brief),
          assumptions: [],
          suggestedActions: [{ type: "direct_echo_retry", label: "Recover Hermes Echo and retry the direct Echo command." }],
          runtimeProvider: "hermes",
          runtimeAgent: "echo",
          isRuntimeFallback: true,
          runtimeError: reason,
        },
      };
    }

    return {
      handled: true,
      response: {
        answer: [
          "## Agent Execution",
          "",
          "- Echo used in Direct Jay Mode.",
          "- CMO was not invoked for strategic decisioning.",
          "",
          "## Echo Output",
          "",
          ...result.response.outputs.flatMap((output) => [`### ${output.label}`, output.copy, ""]),
          ...(result.response.notes.length ? ["## Optional Notes", "", ...result.response.notes.map((note) => `- ${note}`)] : []),
        ].join("\n").trim(),
        assumptions: [],
        suggestedActions: [{ type: "direct_echo_completed", label: "Review Echo direct output." }],
        runtimeProvider: "hermes",
        runtimeAgent: "echo",
        isRuntimeFallback: false,
      },
    };
  }
  if (explicitBypass(request.message)) {
    return {
      handled: true,
      response: {
        answer: [
          "## Temporary CMO draft — Echo bypass requested",
          "",
          "Echo execution was explicitly bypassed. Treat any copy below as a temporary CMO draft for review only, not specialist-final output.",
          "",
          request.message,
        ].join("\n"),
        assumptions: ["Echo bypass was explicitly requested."],
        suggestedActions: [{ type: "echo_bypass", label: "Send this to Echo before treating it as final content." }],
        runtimeProvider: "dashboard",
        runtimeAgent: "cmo",
        isRuntimeFallback: false,
      },
    };
  }

  if (!isFinalContentAsset(request.message)) {
    return { handled: false };
  }

  const platform = platformFromMessage(request.message);

  if (!platform) {
    return {
      handled: true,
      response: {
        answer: [
          "## Need Clarification",
          "",
          "I can route this final content request to Echo, but I need the target platform first.",
          "",
          "Please specify the platform, e.g. X, Facebook, LinkedIn, Telegram, or Discord.",
          "",
          "No Hermes Echo execution was called.",
        ].join("\n"),
        assumptions: [],
        suggestedActions: [{ type: "clarification", label: "Specify the target platform for Echo." }],
        runtimeProvider: "dashboard",
        runtimeAgent: "cmo",
        isRuntimeFallback: false,
      },
    };
  }

  if (isStrategicOnly(request.message)) {
    return { handled: false };
  }

  const brief = buildEchoBrief(request, platform);

  if (!isHermesExecutionEnabled()) {
    return {
      handled: true,
      response: {
        answer: unavailableAnswer("Hermes execution is disabled.", "Hermes execution is disabled.", brief),
        assumptions: [],
        suggestedActions: [{ type: "echo_retry", label: "Enable Hermes Echo execution and retry." }],
        runtimeProvider: "hermes",
        runtimeAgent: "echo",
        isRuntimeFallback: true,
        runtimeError: "Hermes execution is disabled.",
      },
    };
  }

  const result = await executeHermesEcho(brief);

  if (!result.ok || !result.response) {
    const reason = result.failureReason ?? "Hermes Echo execution failed.";
    return {
      handled: true,
      response: {
        answer: unavailableAnswer("Hermes Echo execution failed.", reason, brief),
        assumptions: [],
        suggestedActions: [{ type: "echo_retry", label: "Fix Hermes Echo execution and retry." }],
        runtimeProvider: "hermes",
        runtimeAgent: "echo",
        isRuntimeFallback: true,
        runtimeError: reason,
      },
    };
  }

  return {
    handled: true,
    response: {
      answer: [
        "## Agent Execution",
        `Echo completed handoff ${result.response.handoff_id}.`,
        "",
        "## CMO Review",
        "CMO reviewed the specialist output for boundary compliance: Echo drafted copy only, did not change strategy, did not invent unsupported metrics, and did not publish.",
        ...(result.response.notes.length ? ["", "Notes:", ...result.response.notes.map((note) => `- ${note}`)] : []),
        "",
        "## Echo Output",
        "",
        ...result.response.outputs.flatMap((output) => [`### ${output.label}`, output.copy, ""]),
      ].join("\n").trim(),
      assumptions: [],
      suggestedActions: [{ type: "echo_completed", label: "Review Echo output and select the strongest variant." }],
      runtimeProvider: "hermes",
      runtimeAgent: "echo",
      isRuntimeFallback: false,
    },
  };
}
