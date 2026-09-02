export type NativeFetchResult<T> = {
  ok: boolean;
  status: number;
  data: T;
};

export type NativeFetchOptions = {
  invalidResponseMessage?: string;
  httpErrorMessage?: string;
};

const DEFAULT_INVALID_RESPONSE_MESSAGE =
  "Odgovor servera nije validan. Osvežite stranicu i pokušajte ponovo.";
const DEFAULT_HTTP_ERROR_MESSAGE = "Zahtev nije uspeo. Pokušajte ponovo.";

export class NativeFetchError<T = unknown> extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data?: T,
  ) {
    super(message);
    this.name = "NativeFetchError";
  }
}

export function getNativeFetchErrorData<T>(error: unknown): T | undefined {
  return error instanceof NativeFetchError ? error.data as T | undefined : undefined;
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

/**
 * Parse a native fetch response in one place. This deliberately returns
 * unsuccessful HTTP responses so callers that need a partial error payload
 * can inspect it before calling assertNativeFetchSuccess.
 */
export async function readNativeFetchResponse<T>(
  response: Response,
  options: NativeFetchOptions = {},
): Promise<NativeFetchResult<T>> {
  let data: unknown;
  if (response.status === 204) {
    data = undefined;
  } else {
    try {
      data = await response.json();
    } catch {
      throw new NativeFetchError(
        options.invalidResponseMessage ?? DEFAULT_INVALID_RESPONSE_MESSAGE,
        response.status,
      );
    }
  }

  return { ok: response.ok, status: response.status, data: data as T };
}

export function assertNativeFetchSuccess<T>(
  result: NativeFetchResult<T>,
  fallback = DEFAULT_HTTP_ERROR_MESSAGE,
): T {
  if (!result.ok) {
    throw new NativeFetchError(
      errorMessageFromPayload(result.data, fallback),
      result.status,
      result.data,
    );
  }
  return result.data;
}

export async function fetchNativeJsonResponse<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: NativeFetchOptions,
): Promise<NativeFetchResult<T>> {
  const response = await fetch(input, init);
  return readNativeFetchResponse<T>(response, options);
}

export async function fetchNativeJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: NativeFetchOptions = {},
): Promise<T> {
  const result = await fetchNativeJsonResponse<T>(input, init, options);
  return assertNativeFetchSuccess(result, options.httpErrorMessage);
}