// Hand-written Amazon Creators API client. Bearer token + JSON POST. No SDK.
// Only the Gate Durable Object calls these functions, so the 1 TPS pacing lives in one place.
import type { GetItemsResponse, SearchItemsResponse, SearchParams } from "./types";

export const TOKEN_URL = "https://api.amazon.com/auth/o2/token"; // NA, credential version 3.1
export const API_BASE = "https://creatorsapi.amazon/catalog/v1";
export const MARKETPLACE = "www.amazon.com";
export const TIMEOUT_MS = 8_000; // per-request ceiling; the Gate passes a smaller value when the call has already waited

export const ITEM_RESOURCES = [
  "itemInfo.title",
  "itemInfo.byLineInfo",
  "images.primary.medium",
  "offersV2.listings.price",
  "offersV2.listings.availability",
  "offersV2.listings.dealDetails",
  "offersV2.listings.type",
  "offersV2.listings.merchantInfo",
  "offersV2.listings.isBuyBoxWinner",
  "parentASIN",
];

export class AmazonError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
  get isThrottle() { return this.status === 429; }
  get isAuth() { return this.status === 401 || this.status === 403; }
}

export interface Token { accessToken: string; expiresAt: number }

export async function fetchToken(clientId: string, clientSecret: string, timeoutMs = TIMEOUT_MS): Promise<Token> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "creatorsapi::default" }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const retry = Number(res.headers.get("retry-after")) || undefined;
    const body = await res.text().catch(() => "");
    throw new AmazonError(`LWA token ${res.status}: ${body.slice(0, 200)}`, res.status, "token_error", retry);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
}

async function post<T>(op: string, body: Record<string, unknown>, token: string, timeoutMs: number): Promise<T> {
  const res = await fetch(`${API_BASE}/${op}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-marketplace": MARKETPLACE },
    body: JSON.stringify({ marketplace: MARKETPLACE, ...body }),
    signal: AbortSignal.timeout(Math.min(timeoutMs, TIMEOUT_MS)),
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (res.status === 404) return json as T; // "no results" is a 404 with an errors[] body
  if (!res.ok) {
    const err = json?.errors?.[0] ?? json;
    const retry = Number(json?.retryAfterSeconds ?? res.headers.get("retry-after")) || undefined;
    throw new AmazonError(`${op} ${res.status}: ${err?.code ?? err?.__type ?? ""} ${err?.message ?? text.slice(0, 200)}`, res.status, String(err?.code ?? err?.__type ?? "http_error"), retry);
  }
  return json as T;
}

export function getItems(asins: string[], partnerTag: string, token: string, timeoutMs = TIMEOUT_MS) {
  return post<GetItemsResponse>("getItems", { partnerTag, itemIds: asins.slice(0, 10), itemIdType: "ASIN", resources: ITEM_RESOURCES }, token, timeoutMs);
}

export function searchItems(p: SearchParams, partnerTag: string, token: string, timeoutMs = TIMEOUT_MS) {
  const body: Record<string, unknown> = {
    partnerTag,
    keywords: p.keywords,
    itemCount: Math.min(Math.max(p.itemCount ?? 10, 1), 10),
    itemPage: p.itemPage ?? 1,
    availability: "Available",
    condition: "New",
    resources: ITEM_RESOURCES,
  };
  if (p.maxPriceCents) body.maxPrice = p.maxPriceCents;
  if (p.minPriceCents) body.minPrice = p.minPriceCents;
  if (p.minSavingPercent) body.minSavingPercent = p.minSavingPercent;
  if (p.minReviewsRating) body.minReviewsRating = p.minReviewsRating;
  if (p.searchIndex) body.searchIndex = p.searchIndex;
  if (p.browseNodeId) body.browseNodeId = p.browseNodeId;
  if (p.sortBy) body.sortBy = p.sortBy;
  if (p.primeOnly) body.deliveryFlags = ["Prime"];
  return post<SearchItemsResponse>("searchItems", body, token, timeoutMs);
}
