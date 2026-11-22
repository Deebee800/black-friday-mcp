import { describe, expect, it } from "vitest";
import { toCard } from "../src/amazon/map";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config";
import { DISCLOSURE, LINK_HINT, MARKET_NOTE, cardLine, priceText, savingsText, staleNote, toolResult } from "../src/mcp/format";
import { cacheKey } from "../src/cache";

const card = toCard({
  asin: "B0TEST0001", detailPageURL: "https://www.amazon.com/dp/B0TEST0001?tag=x-20",
  itemInfo: { title: { displayValue: "Thing" } },
  offersV2: { listings: [{ price: { money: { amount: 10, currency: "USD", displayAmount: "$10.00" } }, availability: { type: "IN_STOCK_SCARCE" } }] },
}, new Date(Date.now() - 5 * 3600 * 1000).toISOString())!;

describe("format", () => {
  it("embeds the as-of time inside the price string", () => expect(priceText(card)).toMatch(/^\$10\.00 \(as of .+\)$/));
  it("warns when a card is older than the stale threshold", () => expect(staleNote(card, DEFAULT_CONFIG)).toContain("confirm on Amazon"));
  it("card line shows low stock and the untouched URL as a markdown link on the title", () => {
    const line = cardLine(card, DEFAULT_CONFIG, 1);
    expect(line).toContain("Low stock");
    expect(line).toContain("1. [Thing](https://www.amazon.com/dp/B0TEST0001?tag=x-20)");
  });
  it("product responses ask the assistant to keep the links", () => {
    expect(toolResult({ text: "x", structured: {}, products: true }).content[0].text).toContain(LINK_HINT);
    expect(toolResult({ text: "x", structured: {} }).content[0].text).not.toContain(LINK_HINT);
  });
  it("every tool result carries the disclosure block once, plus the US-only note, in text and structured output", () => {
    const r = toolResult({ text: "hi", structured: { a: 1 } });
    const text = r.content[0].text;
    expect(text).toContain(DISCLOSURE.associate);
    expect(text).toContain(DISCLOSURE.prices);
    expect(text).toContain(DISCLOSURE.content);
    expect(text.split(DISCLOSURE.associate).length).toBe(2);
    expect(text).toContain(MARKET_NOTE);
    expect((r.structuredContent as any).disclosure).toContain(DISCLOSURE.associate);
  });
  it("card line can omit availability so check_deal shows it once", () => {
    expect(cardLine(card, DEFAULT_CONFIG)).toContain("Low stock");
    expect(cardLine(card, DEFAULT_CONFIG, undefined, { availability: false })).not.toContain("Low stock");
  });
  it("browse savings quote Amazon's label verbatim (colon trimmed) and caveat list-price discounts", () => {
    const withBasis = (type: string, label?: string) => toCard({
      asin: "B0TEST0002", detailPageURL: "https://www.amazon.com/dp/B0TEST0002?tag=x-20",
      itemInfo: { title: { displayValue: "Thing" } },
      offersV2: { listings: [{ price: { money: { amount: 50, currency: "USD", displayAmount: "$50.00" }, savingBasis: { savingBasisType: type, savingBasisTypeLabel: label, money: { displayAmount: "$100.00" } }, savings: { percentage: 50 } }, availability: { type: "IN_STOCK" } }] },
    }, new Date().toISOString())!;
    expect(savingsText(withBasis("LIST_PRICE", "List Price:"))).toBe('50% off vs Amazon\'s "List Price" $100.00 (weak evidence: list prices often sit above the usual selling price)');
    expect(savingsText(withBasis("LOWEST_PRICE", "Lowest price in 30 days:"))).toContain("a real drop");
    expect(savingsText(withBasis("WAS_PRICE"))).toBe("50% off vs Amazon's reference price $100.00 (likely a real discount)");
  });
});

describe("config", () => {
  it("merges numbers and booleans, ignores junk, caps stale at 24h", () => {
    const c = mergeConfig({ dailyBudget: 400, prewarmEnabled: true, staleMaxS: 999999, tps: "fast", nonsense: 1 });
    expect(c.dailyBudget).toBe(400);
    expect(c.prewarmEnabled).toBe(true);
    expect(c.staleMaxS).toBe(86400);
    expect(c.tps).toBe(DEFAULT_CONFIG.tps);
  });
  it("falls back to defaults on null", () => expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG));
});

describe("cacheKey", () => {
  it("normalises case, whitespace and key order; ignores empty values", async () => {
    const a = await cacheKey("search", { keywords: "  Robot   Vacuum ", maxPriceCents: 30000, primeOnly: undefined });
    const b = await cacheKey("search", { maxPriceCents: 30000, keywords: "robot vacuum", searchIndex: "" });
    expect(a).toBe(b);
    expect(a).not.toBe(await cacheKey("search", { keywords: "robot vacuum", maxPriceCents: 25000 }));
  });
});
