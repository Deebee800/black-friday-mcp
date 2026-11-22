// KV cache with a "fresh" window (offers ≤ 1 h) and a hard 24 h expiry (Amazon IP License 2(h)).
// Values hold only the ProductCard fields we display. Image bytes are never stored, only URLs.
import type { RuntimeConfig } from "./config";

export interface CacheEntry<T> { fetchedAt: string; data: T }
export interface CacheHit<T> extends CacheEntry<T> { ageS: number; fresh: boolean }

export async function cacheKey(kind: string, params: Record<string, unknown>): Promise<string> {
  const norm = Object.keys(params).sort().map(k => {
    const v = params[k];
    if (v === undefined || v === null || v === "") return null;
    return `${k}=${typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : JSON.stringify(v)}`;
  }).filter(Boolean).join("&");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  const hex = [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
  return `v1:${kind}:${hex}`;
}

export async function getCached<T>(kv: KVNamespace, key: string, cfg: RuntimeConfig): Promise<CacheHit<T> | null> {
  const raw = await kv.get<CacheEntry<T>>(key, "json");
  if (!raw?.fetchedAt) return null;
  const ageS = Math.max(0, (Date.now() - Date.parse(raw.fetchedAt)) / 1000);
  if (ageS > cfg.staleMaxS) return null; // never serve past the hard limit
  return { ...raw, ageS, fresh: ageS < cfg.offersTtlS };
}

export async function putCached<T>(kv: KVNamespace, key: string, data: T, cfg: RuntimeConfig, fetchedAt = new Date().toISOString()): Promise<void> {
  const entry: CacheEntry<T> = { fetchedAt, data };
  await kv.put(key, JSON.stringify(entry), { expirationTtl: Math.min(cfg.staleMaxS, 86_400) });
}
