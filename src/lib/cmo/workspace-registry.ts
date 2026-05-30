export interface WorkspaceRegistryEntry {
  tenantId: string;
  workspaceId: string;
  appId: string;
  route: string;
  aliases?: string[];
  sourceId: string;
  logicalAppPath: string;
  physicalAppVaultPath: string;
  appVaultPath: string;
  physicalVaultPath: string;
}

export function buildSourceId(workspaceId: string, appId: string): string {
  return `${workspaceId}__${appId}`;
}

export const workspaceRegistry: WorkspaceRegistryEntry[] = [
  {
    tenantId: "holdstation",
    workspaceId: "holdstation-mini-app",
    appId: "holdstation-mini-app",
    route: "/apps/holdstation-mini-app",
    sourceId: buildSourceId("holdstation", "holdstation-mini-app"),
    logicalAppPath: "Apps/Holdstation Mini App",
    physicalAppVaultPath: "02 Apps/World Mini App/Holdstation Mini App",
    appVaultPath: "Apps/Holdstation Mini App",
    physicalVaultPath: "02 Apps/World Mini App/Holdstation Mini App",
  },
  {
    tenantId: "holdstation",
    workspaceId: "aion",
    appId: "aion",
    route: "/apps/aion",
    sourceId: buildSourceId("aion", "aion"),
    logicalAppPath: "Apps/AION",
    physicalAppVaultPath: "02 Apps/World Mini App/AION",
    appVaultPath: "Apps/AION",
    physicalVaultPath: "02 Apps/World Mini App/AION",
  },
  {
    tenantId: "holdstation",
    workspaceId: "feeback",
    appId: "feeback",
    route: "/apps/feedback",
    aliases: ["feedback"],
    sourceId: buildSourceId("feeback", "feeback"),
    logicalAppPath: "Apps/Feeback",
    physicalAppVaultPath: "02 Apps/World Mini App/Feeback",
    appVaultPath: "Apps/Feeback",
    physicalVaultPath: "02 Apps/World Mini App/Feeback",
  },
  {
    tenantId: "holdstation",
    workspaceId: "winance",
    appId: "winance",
    route: "/apps/winance",
    sourceId: buildSourceId("winance", "winance"),
    logicalAppPath: "Apps/Winance",
    physicalAppVaultPath: "02 Apps/World Mini App/Winance",
    appVaultPath: "Apps/Winance",
    physicalVaultPath: "02 Apps/World Mini App/Winance",
  },
  {
    tenantId: "holdstation",
    workspaceId: "hold-pay",
    appId: "hold-pay",
    route: "/apps/hold-pay",
    sourceId: buildSourceId("hold-pay", "hold-pay"),
    logicalAppPath: "Apps/Hold Pay",
    physicalAppVaultPath: "02 Apps/Hold Pay",
    appVaultPath: "Apps/Hold Pay",
    physicalVaultPath: "02 Apps/Hold Pay",
  },
  {
    tenantId: "holdstation",
    workspaceId: "holdstation-wallet",
    appId: "holdstation-wallet",
    route: "/apps/holdstation-wallet",
    sourceId: buildSourceId("holdstation-wallet", "holdstation-wallet"),
    logicalAppPath: "Apps/Holdstation Wallet",
    physicalAppVaultPath: "02 Apps/Holdstation Wallet",
    appVaultPath: "Apps/Holdstation Wallet",
    physicalVaultPath: "02 Apps/Holdstation Wallet",
  },
];

export function resolveWorkspaceRegistryEntry(value: string): WorkspaceRegistryEntry | undefined {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  const route = normalized.startsWith("/") ? normalized : `/apps/${normalized}`;

  return workspaceRegistry.find(
    (entry) =>
      entry.appId === normalized ||
      entry.workspaceId === normalized ||
      entry.route === route ||
      entry.aliases?.includes(normalized) ||
      entry.aliases?.some((alias) => `/apps/${alias}` === route),
  );
}

export function requireWorkspaceRegistryEntry(value: string): WorkspaceRegistryEntry {
  const entry = resolveWorkspaceRegistryEntry(value);

  if (!entry) {
    throw new Error(`Unknown workspace app scope: ${value}`);
  }

  return entry;
}
