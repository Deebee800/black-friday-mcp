// Pure pre-warm decision logic (no Workers runtime imports so it is unit-testable in plain Node).
import type { RuntimeConfig } from "./config";
import type { SearchParams } from "./amazon/types";

/** Demand record for one cache key: how often real users caused a fetch, and when. */
export interface DemandRecord {
  key: string;
  op: "search" | "items";
  payload: SearchParams | string[];
  count: number;
  lastUserAt: number;
  lastFetchedAt: number;
}

export const DAY_MS = 86_400_000;
const PREWARM_TICKS_PER_DAY = 144; // cron */10
const PREWARM_LEAD_S = 600; // refresh entries expiring within 10 min

/** Pure: which demand records deserve a pre-warm fetch right now. */
export function selectPrewarmCandidates(records: DemandRecord[], cfg: RuntimeConfig, now: number, perTick: number): DemandRecord[] {
  const leadMs = Math.max(cfg.offersTtlS - PREWARM_LEAD_S, 0) * 1000;
  return records
    .filter(r => r.count >= 2 && now - r.lastUserAt <= DAY_MS && now - r.lastFetchedAt > leadMs)
    .sort((a, b) => b.count - a.count || a.lastFetchedAt - b.lastFetchedAt)
    .slice(0, Math.max(0, perTick));
}

export function prewarmPerTick(cfg: RuntimeConfig): number {
  return Math.max(1, Math.ceil((cfg.dailyBudget * cfg.prewarmMaxShare) / PREWARM_TICKS_PER_DAY));
}

