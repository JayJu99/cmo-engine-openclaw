export class CmoAdapterError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = "cmo_adapter_error") {
    super(message);
    this.name = "CmoAdapterError";
    this.status = status;
    this.code = code;
  }
}

export function cmoErrorResponse(error: unknown): Response {
  if (error instanceof CmoAdapterError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.status },
    );
  }

  console.error("Unexpected CMO adapter error", error);

  return Response.json(
    {
      error: "CMO adapter request failed",
      code: "cmo_adapter_unexpected_error",
    },
    { status: 500 },
  );
}
