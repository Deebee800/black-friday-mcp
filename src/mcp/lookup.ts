// Worker-side lookup: KV first, then the Gate Durable Object (the only Amazon caller).
import type { ProductCard, SearchParams } from "../amazon/types";
import { cacheKey, getCached } from "../cache";
import type { RuntimeConfig } from "../config";
import type { GateRequest, GateResult } from "../gate";

export type LookupOp = { op: "search"; params: SearchParams } | { op: "items"; asins: string[] };

export interface LookupOutcome {
  cards: ProductCard[];
  fetchedAt: string;
  fromCache: boolean;
  stale: boolean;
  totalResults?: number;
  /** Set when we could not fetch and had nothing (or only stale) to serve. */
  problem?: GateResult & { ok: false };
}

export function gateStub(env: Env) {
  return env.GATE.get(env.GATE.idFromName("global"));
}

export async function lookup(env: Env, cfg: RuntimeConfig, installId: string, op: LookupOp, source: "user" | "prewarm" = "user"): Promise<LookupOutcome> {
  const params = op.op === "search" ? op.params : { asins: [...op.asins].sort() };
  const key = await cacheKey(op.op, params as Record<string, unknown>);
  const hit = await getCached<{ cards: ProductCard[]; totalResults?: number }>(env.CACHE_KV, key, cfg);
  if (hit?.fresh) {
    return { cards: hit.data.cards, fetchedAt: hit.fetchedAt, fromCache: true, stale: false, totalResults: hit.data.totalResults };
  }
  const req: GateRequest = { installId, key, source, ...(op.op === "search" ? { op: "search", params: op.params } : { op: "items", asins: op.asins }) };
  const res = (await gateStub(env).lookup(req)) as GateResult;
  if (res.ok) {
    return { cards: res.cards, fetchedAt: res.fetchedAt, fromCache: res.coalesced, stale: false, totalResults: res.totalResults };
  }
  if (hit) {
    return { cards: hit.data.cards, fetchedAt: hit.fetchedAt, fromCache: true, stale: true, totalResults: hit.data.totalResults, problem: res };
  }
  return { cards: [], fetchedAt: new Date().toISOString(), fromCache: false, stale: false, problem: res };
}

export function problemMessage(p: GateResult & { ok: false }, E: { installCap: string; rateLimited: string; budget: string; amazonDown: string }): string {
  switch (p.reason) {
    case "install_cap": return E.installCap;
    case "rate_limited": return E.rateLimited;
    case "budget": return E.budget;
    default: return E.amazonDown;
  }
}
