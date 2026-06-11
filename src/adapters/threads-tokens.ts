import { addDays, addSeconds } from "date-fns";

import { fetchWithTimeout, readJsonResponse } from "../util/http.js";

const TOKEN_BASE = "https://graph.threads.net";

export type ThreadsToken = {
  accessToken: string;
  /** ISO timestamp when the token expires. */
  expiresAt: string;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: { message?: string };
};

function expiresAtFrom(expiresInSeconds: number | undefined): string {
  const now = new Date();
  const expiry = expiresInSeconds && expiresInSeconds > 0 ? addSeconds(now, expiresInSeconds) : addDays(now, 60);
  return expiry.toISOString();
}

async function tokenRequest(url: string, action: string): Promise<ThreadsToken> {
  const response = await fetchWithTimeout(url);
  const { ok, status, data, text } = await readJsonResponse<TokenResponse>(response);
  if (!ok || !data?.access_token) {
    throw new Error(`Threads ${action} failed (${status}): ${data?.error?.message ?? text}`);
  }
  return { accessToken: data.access_token, expiresAt: expiresAtFrom(data.expires_in) };
}

/** Exchange a short-lived Threads user token for a long-lived one (~60 days). Needs the app secret. */
export function exchangeForLongLivedToken(shortLivedToken: string, appSecret: string): Promise<ThreadsToken> {
  const params = new URLSearchParams({
    grant_type: "th_exchange_token",
    client_secret: appSecret,
    access_token: shortLivedToken,
  });
  return tokenRequest(`${TOKEN_BASE}/access_token?${params.toString()}`, "token exchange");
}

/** Refresh a long-lived token, extending it ~60 days. The token must be >24h old and unexpired. */
export function refreshLongLivedToken(longLivedToken: string): Promise<ThreadsToken> {
  const params = new URLSearchParams({
    grant_type: "th_refresh_token",
    access_token: longLivedToken,
  });
  return tokenRequest(`${TOKEN_BASE}/refresh_access_token?${params.toString()}`, "token refresh");
}
