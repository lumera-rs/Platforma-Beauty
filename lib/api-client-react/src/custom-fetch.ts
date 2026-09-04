export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

export interface ApiErrorData {
  error?: string;
  message?: string;
  detail?: string;
  code?: string;
  issues?: unknown[];
  [key: string]: unknown;
}

export interface ApiErrorDetails {
  status: number | undefined;
  data: ApiErrorData | null;
  code: string | undefined;
  message: string | undefined;
}

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

function asApiErrorData(value: unknown): ApiErrorData | null {
  return value !== null && typeof value === "object" ? value as ApiErrorData : null;
}

/**
 * Normalizes errors thrown by the generated client without leaking the native
 * Response object or requiring Axios-style response.data access in callers.
 */
export function getApiErrorDetails(error: unknown): ApiErrorDetails {
  const candidate = error as { name?: unknown; status?: unknown; data?: unknown; message?: unknown } | null;
  const isGeneratedApiError =
    error instanceof ApiError ||
    (
      candidate?.name === "ApiError" &&
      typeof candidate.status === "number" &&
      "data" in (candidate ?? {})
    );

  if (!isGeneratedApiError) {
    return {
      status: undefined,
      data: null,
      code: undefined,
      message: undefined,
    };
  }

  const data = asApiErrorData(candidate?.data);
  const code = getStringField(data, "code");
  const message =
    getStringField(data, "error") ??
    getStringField(data, "detail") ??
    getStringField(data, "message");

  return {
    status: typeof candidate?.status === "number" ? candidate.status : undefined,
    data,
    code,
    message,
  };
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  return getApiErrorDetails(error).message ?? fallback;
}

/**
 * Indicates that the request did not receive an HTTP response.
 *
 * The server may still have processed a mutation before the connection was
 * lost, so callers should treat this as an uncertain outcome rather than a
 * confirmed failure.
 */
export class NetworkError extends Error {
  readonly name = "NetworkError";
  readonly cause: unknown;
  readonly method: string;
  readonly url: string;

  constructor(cause: unknown, requestInfo: { method: string; url: string }) {
    const reason = cause instanceof Error ? `: ${cause.message}` : "";
    super(`Network request failed for ${requestInfo.method} ${requestInfo.url}${reason}`);
    Object.setPrototypeOf(this, new.target.prototype);

    this.cause = cause;
    this.method = requestInfo.method;
    this.url = requestInfo.url;
  }
}

/**
 * Identifies transport failures without relying only on instanceof.  Generated
 * clients can be loaded more than once in a browser, which would otherwise
 * make an equivalent NetworkError from another module copy look like a
 * generic error.
 */
export function isNetworkError(error: unknown): error is NetworkError {
  if (error instanceof NetworkError) return true;

  const candidate = error as {
    name?: unknown;
    method?: unknown;
    url?: unknown;
  } | null;

  return (
    candidate?.name === "NetworkError" &&
    typeof candidate.method === "string" &&
    typeof candidate.url === "string"
  );
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);
  const bookingCommandStorageKey = attachBookingCommandKey(method, resolveUrl(input), init.body, headers);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  let response: Response;
  try {
    response = await fetch(input, { ...init, method, headers });
  } catch (cause) {
    throw new NetworkError(cause, requestInfo);
  }

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  const result = (await parseSuccessBody(response, responseType, requestInfo)) as T;
  if (bookingCommandStorageKey && typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(bookingCommandStorageKey);
  }
  return result;
}

/**
 * Maintainability note (investigated for Task #4D): this list used to be the
 * ONLY thing standing between a booking-creation request and a missing
 * Idempotency-Key, so adding a new booking endpoint here silently determined
 * whether it got retry protection at all -- an easy thing to forget.
 *
 * That is no longer true. Since orval.config.ts's `output.headers: true`
 * (Task #4C), every generated call for an operation that declares
 * Idempotency-Key -- which includes every path below -- requires an
 * explicit `headers` argument to typecheck at all, independent of this
 * list. A new booking-creation endpoint called through the generated
 * client therefore does NOT need an entry here for correctness: TypeScript
 * itself forces the caller to supply a key (see bookingCommandKey() below
 * for the reusable, sessionStorage-backed choice already used by every
 * current booking-creation call site, and the Task #4C/#4D commits for the
 * lifecycle pattern -- stable across retries, rotated only after confirmed
 * success or an intentional new attempt).
 *
 * What remains is a narrower, genuinely-still-open gap: raw fetch() calls
 * that bypass the generated client entirely are outside the type system,
 * so nothing forces them to set a header at all. attachBookingCommandKey()
 * below is retained specifically as a safety net for exactly that case. A
 * generic fix -- deriving this list from the OpenAPI spec automatically --
 * would require either a new codegen step writing into this hand-authored
 * file or a runtime dependency on the spec from the browser bundle; both
 * are a materially bigger change than this maintenance concern justifies,
 * so it has been left as a manually-maintained (but now much lower-stakes)
 * list rather than redesigned.
 */
const BOOKING_CREATION_PATHS = [
  /^\/api\/appointments$/,
  /^\/api\/booking-groups$/,
  /^\/api\/salon\/appointments$/,
  /^\/api\/salon\/booking-groups$/,
  /^\/api\/salon\/appointment-series$/,
  /^\/api\/salon\/package-appointments$/,
  /^\/api\/employee\/appointments$/,
  /^\/api\/employee\/booking-groups$/,
  /^\/api\/employee\/appointment-series$/,
  /^\/api\/widget\/salons\/[^/]+\/appointments$/,
  /^\/api\/widget\/salons\/[^/]+\/booking-groups$/,
];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function bookingCommandStorageKey(pathname: string, body: unknown): string {
  return `lumera:booking-command:${shortHash(`${pathname}\n${stableJson(body)}`)}`;
}

/**
 * Returns the same idempotency key customFetch's own automatic booking-
 * command fallback (below) would silently generate for this exact
 * (pathname, body) pair -- persisted in sessionStorage so a retry (network
 * error, page refresh) of the identical logical booking reuses it, and a
 * later, genuinely different booking with the same canonical payload gets a
 * fresh one once cleared (see clearBookingCommandKey).
 *
 * Exposed so a caller that now has to pass a typed Idempotency-Key header
 * explicitly (generated operations with a required `headers` argument) can
 * obtain the identical value instead of minting an unrelated one that would
 * defeat retry / duplicate-submission protection. `pathname` must be the
 * exact API path the request will hit (e.g. "/api/booking-groups"), with
 * any path parameters already resolved, matching BOOKING_CREATION_PATHS.
 */
export function bookingCommandKey(pathname: string, body: unknown): string {
  const storageKey = bookingCommandStorageKey(pathname, body);
  let key: string | null = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(storageKey) : null;
  key ??= typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(storageKey, key);
  return key;
}

/**
 * Retires a key obtained from bookingCommandKey() once its request has
 * succeeded, mirroring customFetch's own post-success cleanup below, so a
 * later distinct booking with the same canonical payload is not mistaken
 * for a replay of this one.
 */
export function clearBookingCommandKey(pathname: string, body: unknown): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(bookingCommandStorageKey(pathname, body));
}

/**
 * A small, framework-agnostic idempotency-key lifecycle for "settle/act on
 * one specific target among a list" UI flows (e.g. one row's action button
 * in a table), where a plain single `useState` slot would be wrong because
 * several distinct targets can each be independently retried.
 *
 * `keyFor(targetId)` returns a key stable across retries of that target
 * (generating one on first use, reusing it after); `clear(targetId)`
 * retires it once that target's command is confirmed done, so a later,
 * genuinely new command against the same target id gets a fresh key
 * instead of replaying the old one.
 *
 * Typical use: `const keys = useRef(createTargetedIdempotencyKeys()).current;`
 * then `keys.keyFor(row.id)` in the mutate call and `keys.clear(row.id)` in
 * onSuccess.
 */
export function createTargetedIdempotencyKeys() {
  const keys = new Map<string, string>();
  return {
    keyFor(targetId: string): string {
      let key = keys.get(targetId);
      if (!key) {
        key = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        keys.set(targetId, key);
      }
      return key;
    },
    clear(targetId: string): void {
      keys.delete(targetId);
    },
  };
}

/**
 * Keeps one command key for an in-flight JSON booking payload. Network errors
 * and page refreshes retain it; a parsed successful response retires it.
 */
function attachBookingCommandKey(
  method: string,
  url: string,
  body: BodyInit | null | undefined,
  headers: Headers,
): string | null {
  if (method !== "POST" || headers.has("idempotency-key") || typeof body !== "string") return null;
  const pathname = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin).pathname;
  if (!BOOKING_CREATION_PATHS.some((pattern) => pattern.test(pathname))) return null;
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return null;
  }
  headers.set("Idempotency-Key", bookingCommandKey(pathname, parsedBody));
  return bookingCommandStorageKey(pathname, parsedBody);
}
