/**
 * Shared HTTP helpers used by the platform adapters and the OpenAI LLM client.
 *
 * Every outbound request gets a hard timeout (a hung upload must not block the
 * whole publish forever) and automatic retry on HTTP 429 only. We deliberately
 * do NOT retry on 5xx, timeouts, or network errors: most platform endpoints are
 * non-idempotent POSTs (creating a post, uploading media), and a blind retry
 * after a request may already have been processed would duplicate posts. A 429
 * is always safe to retry because the request was rejected before processing.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_RETRIES = 2;
const MAX_BACKOFF_MS = 30_000;

export type FetchOptions = {
  /** Abort the request after this many milliseconds. Defaults to 30s. */
  timeoutMs?: number;
  /** How many times to retry on HTTP 429. Defaults to 2. */
  rateLimitRetries?: number;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parse a `Retry-After` header (delta-seconds or HTTP date); fall back to exponential backoff with jitter. */
function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0), MAX_BACKOFF_MS);
    }
  }
  const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * 250);
}

/** `fetch` with a timeout and safe rate-limit retry. See file header for the retry policy. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  options: FetchOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const rateLimitRetries = options.rateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 429 || attempt >= rateLimitRetries) {
      return response;
    }
    await sleep(retryDelayMs(response, attempt));
  }
}

export type JsonResponse<T> = {
  ok: boolean;
  status: number;
  /** Parsed body, or null when the body was empty or not valid JSON. */
  data: T | null;
  /** Raw response text, always available for error messages. */
  text: string;
};

/** Read a response body once, parsing JSON defensively so an HTML error page never throws a bare SyntaxError. */
export async function readJsonResponse<T>(response: Response): Promise<JsonResponse<T>> {
  const text = await response.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data, text };
}
