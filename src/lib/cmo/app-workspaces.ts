import type { AppWorkspace, VaultNoteRef } from "@/lib/cmo/app-workspace-types";
import { buildSourceId, requireWorkspaceRegistryEntry } from "@/lib/cmo/workspace-registry";

export const HOLDSTATION_WORKSPACE_ID = "holdstation";
export const HOLDSTATION_VAULT_ROOT = "knowledge/holdstation";

function registryFields(appId: string) {
  const entry = requireWorkspaceRegistryEntry(appId);

  return {
    workspaceId: entry.workspaceId,
    sourceId: entry.sourceId || buildSourceId(entry.workspaceId, entry.appId),
    logicalAppPath: entry.logicalAppPath,
    physicalAppVaultPath: entry.physicalAppVaultPath,
    appVaultPath: entry.logicalAppPath,
    vaultPath: entry.physicalAppVaultPath,
    route: entry.route,
  };
}

export const holdstationApps: AppWorkspace[] = [
  {
    id: "holdstation-mini-app",
    slug: "holdstation-mini-app",
    ...registryFields("holdstation-mini-app"),
    name: "Holdstation Mini App",
    group: "World Mini App",
    stage: "Active",
    currentMission: "Define the next app-specific CMO session.",
    lastUpdated: "Vault-backed",
    oneLiner: "Mini app workspace for product, audience, and content direction.",
  },
  {
    id: "aion",
    slug: "aion",
    ...registryFields("aion"),
    name: "AION",
    group: "World Mini App",
    stage: "Discovery",
    currentMission: "Clarify positioning before expanding campaign work.",
    lastUpdated: "Vault-backed",
  },
  {
    id: "feeback",
    slug: "feeback",
    ...registryFields("feeback"),
    name: "Feeback",
    group: "World Mini App",
    stage: "Discovery",
    currentMission: "Capture context and identify the first useful CMO question.",
    lastUpdated: "Vault-backed",
  },
  {
    id: "winance",
    slug: "winance",
    ...registryFields("winance"),
    name: "Winance",
    group: "World Mini App",
    stage: "Discovery",
    currentMission: "Build the first app operating context.",
    lastUpdated: "Vault-backed",
  },
  {
    id: "hold-pay",
    slug: "hold-pay",
    ...registryFields("hold-pay"),
    name: "Hold Pay",
    group: "Payments",
    stage: "Active",
    currentMission: "Focus CMO discussion around product and audience notes.",
    lastUpdated: "Vault-backed",
  },
  {
    id: "holdstation-wallet",
    slug: "holdstation-wallet",
    ...registryFields("holdstation-wallet"),
    name: "Holdstation Wallet",
    group: "Wallet",
    stage: "Active",
    currentMission: "Keep wallet-specific strategy separate from generic briefing.",
    lastUpdated: "Vault-backed",
  },
];

export const appNoteTemplates = [
  {
    id: "positioning",
    title: "Positioning",
    fileName: "Positioning.md",
    reason: "App positioning context",
    selected: true,
  },
  {
    id: "audience",
    title: "Audience",
    fileName: "Audience.md",
    reason: "Who this app is for and what they care about",
    selected: true,
  },
  {
    id: "product-notes",
    title: "Product Notes",
    fileName: "Product Notes.md",
    reason: "Product facts, constraints, and UX context",
    selected: true,
  },
  {
    id: "content-notes",
    title: "Content Notes",
    fileName: "Content Notes.md",
    reason: "Messaging, content angles, and channel context",
    selected: true,
  },
  {
    id: "c-level-priorities",
    title: "C-Level Priorities",
    fileName: "C-Level Priorities.md",
    reason: "Current executive priority that should shape CMO recommendations",
    selected: true,
  },
  {
    id: "decisions",
    title: "Decisions",
    fileName: "Decisions.md",
    reason: "Confirmed decisions and unresolved decision points",
    selected: true,
  },
  {
    id: "tasks",
    title: "Tasks",
    fileName: "Tasks.md",
    reason: "Open tasks and follow-ups for this app",
    selected: true,
  },
  {
    id: "learnings",
    title: "Learnings",
    fileName: "Learnings.md",
    reason: "Validated learnings and evidence from prior sessions",
    selected: true,
  },
  {
    id: "project-docs",
    title: "Project Docs",
    fileName: "Inputs/Project Docs.md",
    reason: "Selected project documents and source context",
    selected: false,
  },
  {
    id: "meeting-inputs",
    title: "Meeting Inputs",
    fileName: "Inputs/Meeting Inputs.md",
    reason: "Meeting notes and source inputs selected for this app",
    selected: false,
  },
  {
    id: "metrics-snapshot",
    title: "Metrics Snapshot",
    fileName: "Inputs/Metrics Snapshot.md",
    reason: "User-provided metrics snapshot when available",
    selected: false,
  },
] as const;

export function listAppWorkspaces(): AppWorkspace[] {
  return holdstationApps;
}

export function getAppWorkspace(appId: string): AppWorkspace | undefined {
  return holdstationApps.find((app) => app.id === appId || app.slug === appId);
}

export function buildAppContextNotes(app: AppWorkspace): VaultNoteRef[] {
  return appNoteTemplates.map((note) => ({
    id: `${app.id}-${note.id}`,
    title: note.title,
    path: `${app.physicalAppVaultPath}/${note.fileName}`,
    type: "app-note",
    reason: note.reason,
    selected: note.selected,
  }));
}
