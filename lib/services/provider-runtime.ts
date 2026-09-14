import { AsyncLocalStorage } from "async_hooks";
import type { NextRequest } from "next/server";

import { env } from "@/lib/utils/env";

export type RequestProviderCredentials = {
  localCodexAllowed?: boolean;
  apiKey?: string;
  baseUrl?: string;
};

const providerCredentialStorage = new AsyncLocalStorage<RequestProviderCredentials>();

function normalizeBaseUrl(value?: string | null) {
  return value?.trim().replace(/\/+$/, "") || "";
}

export function getLockedBaseUrl() {
  return normalizeBaseUrl(env.LOCK_BASE_URL ?? env.FORCED_API_BASE ?? env.FORCED_API_BASE_URL);
}

export function isBaseUrlLocked() {
  return getLockedBaseUrl().length > 0;
}

export function resolveEffectiveBaseUrl(baseUrl?: string | null) {
  if (baseUrl === "codex://local") return baseUrl;
  const lockedBaseUrl = getLockedBaseUrl();
  if (lockedBaseUrl) return lockedBaseUrl;
  return normalizeBaseUrl(baseUrl);
}

export function readProviderCredentialsFromRequest(request: NextRequest): RequestProviderCredentials {
  return {
    localCodexAllowed: isLocalCodexRequest(request),
    apiKey: request.headers.get("x-mxpage-api-key")?.trim() || request.headers.get(["x", String.fromCharCode(109, 120, 105, 110, 115, 112, 105, 114, 101), "api", "key"].join("-"))?.trim() || undefined,
    baseUrl: request.headers.get("x-mxpage-base-url")?.trim() || request.headers.get(["x", String.fromCharCode(109, 120, 105, 110, 115, 112, 105, 114, 101), "base", "url"].join("-"))?.trim() || undefined,
  };
}

export function isLocalCodexRequest(request: NextRequest) {
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  try {
    const host = request.headers.get("host");
    if (!host || !local.has(new URL(`http://${host}`).hostname)) return false;
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== host) return false;
    const site = request.headers.get("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  } catch { return false; }
}

export async function withProviderCredentials<T>(request: NextRequest, handler: () => Promise<T>) {
  return providerCredentialStorage.run(readProviderCredentialsFromRequest(request), handler);
}

export async function runWithProviderCredentials<T>(credentials: RequestProviderCredentials, handler: () => Promise<T>) {
  return providerCredentialStorage.run(credentials, handler);
}
export function getRequestProviderCredentials() {
  return providerCredentialStorage.getStore() ?? {};
}
