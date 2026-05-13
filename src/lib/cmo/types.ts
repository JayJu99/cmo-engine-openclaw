export const CMO_SCHEMA_VERSION = "cmo.dashboard.v1" as const;

export type CmoSchemaVersion = typeof CMO_SCHEMA_VERSION;
export type CmoPriority = "High" | "Medium" | "Low" | "Opportunity";
export type CmoStatus =
  | "Running"
  | "Idle"
  | "Need Review"
  | "Need Approval"
  | "In Progress"
  | "Done"
  | "Indexed"
  | "Fresh"
  | "Locked"
  | "Synced"
  | "Review"
  | "Protected"
  | "completed"
  | "failed"
  | "timeout"
  | "partial"
  | "invalid"
  | "mock";
export type CmoTone = "violet" | "green" | "blue" | "orange" | "pink" | "slate" | "red";
export type CmoChatRunStatus = "running" | "completed" | "failed" | "timeout";

export interface CmoVersioned {
  schema_version: CmoSchemaVersion;
}

export interface CmoSummary extends CmoVersioned {
  title: string;
  market_sentiment: string;
  content_momentum: string;
  top_opportunity: string;
  risk: string;
  next_action: string;
}

export interface CmoAction extends CmoVersioned {
  id: string;
  title: string;
  summary: string;
  priority: CmoPriority;
  source: string;
  agent: string;
  time: string;
  type: string;
}

export interface CmoSignal extends CmoVersioned {
  id: string;
  title: string;
  summary: string;
  category: string;
  source: string;
  severity: CmoPriority;
  time: string;
}

export interface CmoAgent extends CmoVersioned {
  id: string;
  name: string;
  codename: string;
  status: CmoStatus;
  tone: CmoTone;
  progress: number;
  description: string;
  activity: string;
  metricA: string;
  metricB: string;
}

export interface CmoReport extends CmoVersioned {
  id: string;
  title: string;
  type: string;
  meta: string;
  stats: [string, string, string] | string[];
  tone: CmoTone;
}

export interface CmoVaultItem extends CmoVersioned {
  id: string;
  name: string;
  type: string;
  status: CmoStatus;
  count: string;
  tone: CmoTone;
}

export interface CmoCampaign extends CmoVersioned {
  id: string;
  name: string;
  title: string;
  channels: string[];
  stage: string;
  owner_agent: string;
  status: CmoStatus;
  progress: number;
  last_updated: string;
  summary: string;
  next_action: string;
  tone: CmoTone;
}

export interface CmoRun extends CmoVersioned {
  run_id: string;
  created_at: string;
  workspace: string;
  status: CmoStatus;
  summary: CmoSummary;
  actions: CmoAction[];
  signals: CmoSignal[];
  agents: CmoAgent[];
  campaigns: CmoCampaign[];
  reports: CmoReport[];
  vault: CmoVaultItem[];
}

export interface CmoRawOutput extends CmoVersioned {
  run_id: string;
  captured_at: string;
  source: "mock" | "openclaw" | "cli";
  runtime: string;
  // Raw output is an unstable OpenClaw, agent, or runtime payload. It is stored
  // for debugging and must not be rendered directly by dashboard UI components.
  payload: unknown;
}

export interface CmoRunIndexItem extends CmoVersioned {
  run_id: string;
  created_at: string;
  workspace: string;
  status: CmoStatus;
  title: string;
  actions_count: number;
  signals_count: number;
  agents_count: number;
  campaigns_count: number;
  reports_count: number;
  vault_count: number;
  has_error: boolean;
}

export interface CmoRunListResponse extends CmoVersioned {
  data: CmoRunIndexItem[];
  total: number;
  limit: number;
}

export interface CmoCollectionResponse<T> extends CmoVersioned {
  run_id: string;
  created_at: string;
  data: T[];
}

export interface CmoChatRun extends CmoVersioned {
  chat_run_id: string;
  created_at: string;
  updated_at: string;
  status: CmoChatRunStatus;
  question: string;
  answer: string;
  context_run_id: string | null;
  raw_markdown_path: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface CmoChatRunIndexItem extends CmoVersioned {
  chat_run_id: string;
  created_at: string;
  updated_at: string;
  status: CmoChatRunStatus;
  question: string;
  context_run_id: string | null;
}

export interface CmoChatRunListResponse extends CmoVersioned {
  data: CmoChatRunIndexItem[];
}
