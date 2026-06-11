import { describe, expect, it, vi } from "vitest";
import { exchangeForLongLivedToken, refreshLongLivedToken } from "./threads-tokens.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe("threads token endpoints", () => {
  it("exchanges a short-lived token via th_exchange_token with the app secret", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ access_token: "long", token_type: "bearer", expires_in: 5_184_000 })
    );
    const result = await withFetch(fetchMock as typeof fetch, () => exchangeForLongLivedToken("short", "secret"));

    expect(result.accessToken).toBe("long");
    expect(Date.parse(result.expiresAt)).not.toBeNaN();
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("https://graph.threads.net/access_token?");
    expect(url).toContain("grant_type=th_exchange_token");
    expect(url).toContain("access_token=short");
    expect(url).toContain("client_secret=secret");
  });

  it("refreshes a long-lived token via th_refresh_token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "refreshed", expires_in: 5_184_000 }));
    const result = await withFetch(fetchMock as typeof fetch, () => refreshLongLivedToken("long"));

    expect(result.accessToken).toBe("refreshed");
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("https://graph.threads.net/refresh_access_token?");
    expect(url).toContain("grant_type=th_refresh_token");
    expect(url).toContain("access_token=long");
  });

  it("surfaces the API error message on failure", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: "token is invalid" } }, 400));
    await expect(withFetch(fetchMock as typeof fetch, () => refreshLongLivedToken("x"))).rejects.toThrow(
      /token is invalid/
    );
  });
});
