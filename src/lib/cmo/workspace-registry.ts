export interface WorkspaceRegistryEntry {
  workspaceId: string;
  appId: string;
  route: string;
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
    workspaceId: "holdstation",
    appId: "holdstation-mini-app",
    route: "/apps/holdstation-mini-app",
    sourceId: buildSourceId("holdstation", "holdstation-mini-app"),
    logicalAppPath: "Apps/Holdstation Mini App",
    physicalAppVaultPath: "02 Apps/World Mini App/Holdstation Mini App",
    appVaultPath: "Apps/Holdstation Mini App",
    physicalVaultPath: "02 Apps/World Mini App/Holdstation Mini App",
  },
  {
    workspaceId: "holdstation",
    appId: "aion",
    route: "/apps/aion",
    sourceId: buildSourceId("holdstation", "aion"),
    logicalAppPath: "Apps/AION",
    physicalAppVaultPath: "02 Apps/World Mini App/AION",
    appVaultPath: "Apps/AION",
    physicalVaultPath: "02 Apps/World Mini App/AION",
  },
  {
    workspaceId: "holdstation",
    appId: "feeback",
    route: "/apps/feeback",
    sourceId: buildSourceId("holdstation", "feeback"),
    logicalAppPath: "Apps/Feeback",
    physicalAppVaultPath: "02 Apps/World Mini App/Feeback",
    appVaultPath: "Apps/Feeback",
    physicalVaultPath: "02 Apps/World Mini App/Feeback",
  },
  {
    workspaceId: "holdstation",
    appId: "winance",
    route: "/apps/winance",
    sourceId: buildSourceId("holdstation", "winance"),
    logicalAppPath: "Apps/Winance",
    physicalAppVaultPath: "02 Apps/World Mini App/Winance",
    appVaultPath: "Apps/Winance",
    physicalVaultPath: "02 Apps/World Mini App/Winance",
  },
  {
    workspaceId: "holdstation",
    appId: "hold-pay",
    route: "/apps/hold-pay",
    sourceId: buildSourceId("holdstation", "hold-pay"),
    logicalAppPath: "Apps/Hold Pay",
    physicalAppVaultPath: "02 Apps/Hold Pay",
    appVaultPath: "Apps/Hold Pay",
    physicalVaultPath: "02 Apps/Hold Pay",
  },
  {
    workspaceId: "holdstation",
    appId: "holdstation-wallet",
    route: "/apps/holdstation-wallet",
    sourceId: buildSourceId("holdstation", "holdstation-wallet"),
    logicalAppPath: "Apps/Holdstation Wallet",
    physicalAppVaultPath: "02 Apps/Holdstation Wallet",
    appVaultPath: "Apps/Holdstation Wallet",
    physicalVaultPath: "02 Apps/Holdstation Wallet",
  },
];

export function resolveWorkspaceRegistryEntry(value: string): WorkspaceRegistryEntry | undefined {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  const route = normalized.startsWith("/") ? normalized : `/apps/${normalized}`;

  return workspaceRegistry.find((entry) => entry.appId === normalized || entry.route === route);
}

export function requireWorkspaceRegistryEntry(value: string): WorkspaceRegistryEntry {
  const entry = resolveWorkspaceRegistryEntry(value);

  if (!entry) {
    throw new Error(`Unknown workspace app scope: ${value}`);
  }

  return entry;
}
