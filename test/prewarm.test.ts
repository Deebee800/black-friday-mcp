import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config";
import { prewarmPerTick, selectPrewarmCandidates, type DemandRecord } from "../src/prewarm";

const H = 3600_000;
const now = 1_800_000_000_000;
const rec = (key: string, over: Partial<DemandRecord> = {}): DemandRecord => ({
  key, op: "search", payload: { keywords: key }, count: 3, lastUserAt: now - H, lastFetchedAt: now - H, ...over,
});

describe("selectPrewarmCandidates", () => {
  it("skips one-off queries (count < 2)", () => {
    expect(selectPrewarmCandidates([rec("a", { count: 1 })], DEFAULT_CONFIG, now, 5)).toEqual([]);
  });
  it("skips queries nobody asked for in 24 h", () => {
    expect(selectPrewarmCandidates([rec("a", { lastUserAt: now - 25 * H })], DEFAULT_CONFIG, now, 5)).toEqual([]);
  });
  it("skips queries whose cache is still comfortably fresh", () => {
    expect(selectPrewarmCandidates([rec("a", { lastFetchedAt: now - 10 * 60_000 })], DEFAULT_CONFIG, now, 5)).toEqual([]);
  });
  it("picks queries expiring within 10 minutes", () => {
    const soon = rec("a", { lastFetchedAt: now - (DEFAULT_CONFIG.offersTtlS - 300) * 1000 });
    expect(selectPrewarmCandidates([soon], DEFAULT_CONFIG, now, 5).map(r => r.key)).toEqual(["a"]);
  });
  it("orders by popularity and caps at perTick", () => {
    const rs = [rec("low", { count: 2 }), rec("high", { count: 9 }), rec("mid", { count: 5 })];
    expect(selectPrewarmCandidates(rs, DEFAULT_CONFIG, now, 2).map(r => r.key)).toEqual(["high", "mid"]);
  });
});

describe("prewarmPerTick", () => {
  it("spreads the daily share over 144 ticks, minimum 1", () => {
    expect(prewarmPerTick({ ...DEFAULT_CONFIG, dailyBudget: 6000, prewarmMaxShare: 0.1 })).toBe(5);
    expect(prewarmPerTick({ ...DEFAULT_CONFIG, dailyBudget: 100, prewarmMaxShare: 0.1 })).toBe(1);
  });
});
