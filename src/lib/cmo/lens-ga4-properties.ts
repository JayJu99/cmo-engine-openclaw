import "server-only";

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
