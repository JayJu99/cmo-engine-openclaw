import "server-only";

import type { WorkspaceGa4VerificationStatus } from "@/lib/cmo/workspace-metric-sources";

export type LensGa4PropertiesErrorCode =
  | "ga4_admin_api_unavailable"
  | "property_access_denied"
  | "ga4_property_discovery_failed";

interface GoogleAnalyticsApiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      reason?: string;
      service?: string;
      metadata?: Record<string, string>;
    }>;
  };
}

interface GoogleAccountSummary {
  name?: string;
  account?: string;
  displayName?: string;
  propertySummaries?: Array<{
    property?: string;
    displayName?: string;
  }>;
}

interface GoogleAccountSummariesResponse {
  accountSummaries?: GoogleAccountSummary[];
  nextPageToken?: string;
}

interface GoogleProperty {
  name?: string;
  parent?: string;
  displayName?: string;
  timeZone?: string;
}

interface GooglePropertiesResponse {
  properties?: GoogleProperty[];
  nextPageToken?: string;
}

export interface LensGa4Property {
  propertyId: string;
  propertyName?: string;
  displayName: string;
  accountId?: string;
  accountName?: string;
  timezone?: string | null;
}

export interface LensGa4PropertiesResult {
  properties: LensGa4Property[];
}

export interface LensGa4PropertyVerificationResult {
  ok: boolean;
  verificationStatus: WorkspaceGa4VerificationStatus;
  code?: string;
  message?: string;
  property?: LensGa4Property;
}

export class LensGa4PropertiesError extends Error {
  code: LensGa4PropertiesErrorCode;

  constructor(code: LensGa4PropertiesErrorCode, message: string) {
    super(message);
    this.name = "LensGa4PropertiesError";
    this.code = code;
  }
}

function idFromName(value: string | undefined, prefix: string): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.startsWith(`${prefix}/`) ? normalized.slice(prefix.length + 1) : normalized;
}

function apiErrorCode(status: number, payload: GoogleAnalyticsApiErrorPayload): LensGa4PropertiesErrorCode {
  const errorText = JSON.stringify(payload).toLowerCase();

  if (status === 403 && (errorText.includes("service_disabled") || errorText.includes("has not been used") || errorText.includes("disabled"))) {
    return "ga4_admin_api_unavailable";
  }

  if (status === 401 || status === 403) {
    return "property_access_denied";
  }

  return "ga4_property_discovery_failed";
}

async function fetchGoogleJson<T>(url: URL, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & GoogleAnalyticsApiErrorPayload;

  if (!response.ok) {
    const code = apiErrorCode(response.status, payload);
    throw new LensGa4PropertiesError(code, code);
  }

  return payload as T;
}

async function listAccountSummaries(accessToken: string): Promise<GoogleAccountSummary[]> {
  const summaries: GoogleAccountSummary[] = [];
  let pageToken = "";

  do {
    const url = new URL("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
    url.searchParams.set("pageSize", "200");

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const payload = await fetchGoogleJson<GoogleAccountSummariesResponse>(url, accessToken);
    summaries.push(...(payload.accountSummaries ?? []));
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);

  return summaries;
}

async function listPropertiesForAccount(accessToken: string, accountName: string): Promise<GoogleProperty[]> {
  const properties: GoogleProperty[] = [];
  let pageToken = "";

  do {
    const url = new URL("https://analyticsadmin.googleapis.com/v1beta/properties");
    url.searchParams.set("filter", `parent:${accountName}`);
    url.searchParams.set("pageSize", "200");
    url.searchParams.set("showDeleted", "false");

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const payload = await fetchGoogleJson<GooglePropertiesResponse>(url, accessToken);
    properties.push(...(payload.properties ?? []));
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);

  return properties;
}

export function normalizeGa4AccountSummaries(input: {
  accountSummaries: GoogleAccountSummary[];
  propertiesByAccountName?: Map<string, GoogleProperty[]>;
}): LensGa4PropertiesResult {
  const byPropertyName = new Map<string, LensGa4Property>();

  for (const account of input.accountSummaries) {
    const accountName = account.account || account.name;
    const accountId = idFromName(accountName, "accounts");
    const propertyDetails = accountName ? input.propertiesByAccountName?.get(accountName) ?? [] : [];
    const detailByName = new Map(propertyDetails.map((property) => [property.name, property]));
    const summaryProperties = account.propertySummaries ?? [];
    const properties: GoogleProperty[] = propertyDetails.length
      ? propertyDetails
      : summaryProperties.map((summary) => ({
          name: summary.property,
          displayName: summary.displayName,
          parent: accountName,
          timeZone: undefined,
        }));

    for (const property of properties) {
      const propertyName = property.name;
      const propertyId = idFromName(propertyName, "properties");

      if (!propertyId) {
        continue;
      }

      const detail = propertyName ? detailByName.get(propertyName) : undefined;
      const displayName = property.displayName?.trim() || detail?.displayName?.trim() || `GA4 Property ${propertyId}`;
      const stableKey = propertyName ?? propertyId;

      byPropertyName.set(stableKey, {
        propertyId,
        propertyName,
        displayName,
        accountId,
        accountName: account.displayName?.trim() || accountId,
        timezone: property.timeZone ?? detail?.timeZone ?? null,
      });
    }
  }

  return {
    properties: [...byPropertyName.values()].sort((left, right) =>
      `${left.accountName ?? ""} ${left.displayName}`.localeCompare(`${right.accountName ?? ""} ${right.displayName}`),
    ),
  };
}

export async function listLensGa4Properties(input: {
  accessToken: string;
}): Promise<LensGa4PropertiesResult> {
  const accountSummaries = await listAccountSummaries(input.accessToken);
  const propertiesByAccountName = new Map<string, GoogleProperty[]>();

  await Promise.all(
    accountSummaries
      .map((summary) => summary.account || summary.name)
      .filter((accountName): accountName is string => Boolean(accountName))
      .map(async (accountName) => {
        propertiesByAccountName.set(accountName, await listPropertiesForAccount(input.accessToken, accountName));
      }),
  );

  return normalizeGa4AccountSummaries({ accountSummaries, propertiesByAccountName });
}

export function ga4VerificationStatusForCode(code: string): WorkspaceGa4VerificationStatus {
  if (code === "token_revoked" || code === "token_expired" || code === "oauth_account_not_found") {
    return "needs_reconnect";
  }

  if (code === "property_access_denied" || code === "property_not_found") {
    return "property_inaccessible";
  }

  return "error";
}

export function ga4VerificationMessageForCode(code: string): string {
  if (code === "token_revoked" || code === "token_expired" || code === "oauth_account_not_found") {
    return "Google connection needs reconnect.";
  }

  if (code === "property_access_denied") {
    return "The selected GA4 property is no longer accessible from this Google account.";
  }

  if (code === "property_not_found") {
    return "The selected GA4 property was not found in this Google account.";
  }

  if (code === "missing_mapping") {
    return "Workspace GA4 mapping is missing.";
  }

  if (code === "ga4_admin_api_unavailable") {
    return "Google Analytics Admin API is unavailable for this connection.";
  }

  return "GA4 source verification failed.";
}

export async function verifyLensGa4PropertyAccess(input: {
  accessToken: string;
  propertyId: string;
}): Promise<LensGa4PropertyVerificationResult> {
  const propertyId = input.propertyId.trim();

  if (!propertyId) {
    return {
      ok: false,
      verificationStatus: "error",
      code: "missing_mapping",
      message: ga4VerificationMessageForCode("missing_mapping"),
    };
  }

  try {
    const properties = await listLensGa4Properties({ accessToken: input.accessToken });
    const property = properties.properties.find((candidate) => candidate.propertyId === propertyId);

    if (!property) {
      return {
        ok: false,
        verificationStatus: "property_inaccessible",
        code: "property_not_found",
        message: ga4VerificationMessageForCode("property_not_found"),
      };
    }

    return {
      ok: true,
      verificationStatus: "verified",
      property,
    };
  } catch (error) {
    if (error instanceof LensGa4PropertiesError) {
      const verificationStatus = ga4VerificationStatusForCode(error.code);

      return {
        ok: false,
        verificationStatus,
        code: error.code,
        message: ga4VerificationMessageForCode(error.code),
      };
    }

    return {
      ok: false,
      verificationStatus: "error",
      code: "ga4_admin_api_unavailable",
      message: ga4VerificationMessageForCode("ga4_admin_api_unavailable"),
    };
  }
}
