import { cmoErrorResponse, CmoAdapterError } from "@/lib/cmo/errors";

export function studioRouteErrorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Invalid JSON body.", code: "invalid_json" }, { status: 400 });
  }

  if (error instanceof Error && error.message.includes("Authentication required")) {
    return Response.json({ error: "Authentication required.", code: "authentication_required" }, { status: 401 });
  }

  if (error instanceof CmoAdapterError) {
    return cmoErrorResponse(error);
  }

  return cmoErrorResponse(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json() as unknown;

  return isRecord(body) ? body : {};
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
