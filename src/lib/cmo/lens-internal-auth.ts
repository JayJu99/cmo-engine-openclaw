import "server-only";

import { timingSafeEqual } from "crypto";

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizeLensInternalRequest(request: Request): Response | null {
  const configuredKey = process.env.CMO_LENS_INTERNAL_API_KEY?.trim();
  const token = bearerToken(request);

  if (!configuredKey || !token || !constantTimeEquals(token, configuredKey)) {
    return Response.json(
      {
        error: "Unauthorized.",
        code: "unauthorized",
      },
      { status: 401 },
    );
  }

  return null;
}
