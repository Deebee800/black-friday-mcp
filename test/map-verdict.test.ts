import { describe, expect, it } from "vitest";
import { toCard } from "../src/amazon/map";
import type { ApiItem, Listing } from "../src/amazon/types";
import { verdict } from "../src/mcp/verdict";

const base = (over: Partial<NonNullable<Listing["price"]>> = {}, extra: Partial<ApiItem> = {}): ApiItem => ({
  asin: "B0TEST0001",
  detailPageURL: "https://www.amazon.com/dp/B0TEST0001?tag=x-20&linkCode=ogi&th=1&psc=1",
  itemInfo: { title: { displayValue: "Test Robot Vacuum" } },
  images: { primary: { medium: { url: "https://m.media-amazon.com/images/I/x._SL160_.jpg" } } },
  offersV2: { listings: [{ price: { money: { amount: 249.99, currency: "USD", displayAmount: "$249.99" }, ...over }, availability: { type: "IN_STOCK" }, isBuyBoxWinner: true }] },
  ...extra,
});
const at = "2026-11-20T19:14:00.000Z";

describe("toCard", () => {
  it("keeps the URL byte-for-byte and maps price/availability", () => {
    const c = toCard(base(), at)!;
    expect(c.url).toBe("https://www.amazon.com/dp/B0TEST0001?tag=x-20&linkCode=ogi&th=1&psc=1");
    expect(c.price?.display).toBe("$249.99");
    expect(c.availability).toBe("IN_STOCK");
    expect(c.fetchedAt).toBe(at);
  });
  it("marks NO_OFFER when there are no listings", () => {
    expect(toCard(base({}, { offersV2: { listings: [] } }), at)!.availability).toBe("NO_OFFER");
  });
  it("flags MAP-hidden prices", () => {
    const item = base(); item.offersV2!.listings![0].price = {}; item.offersV2!.listings![0].violatesMAP = true;
    expect(toCard(item, at)!.mapHidden).toBe(true);
  });
  it("returns null without a detail page URL", () => {
    expect(toCard({ asin: "B0TEST0001" } as ApiItem, at)).toBeNull();
  });
});

describe("verdict", () => {
  const withBasis = (type: string, label: string, pct: number) =>
    toCard(base({ savingBasis: { savingBasisType: type, savingBasisTypeLabel: label, money: { displayAmount: "$299.99" } }, savings: { percentage: pct } }), at)!;
  it("lowest-price basis + big drop = strong", () => expect(verdict(withBasis("LOWEST_PRICE", "Lowest price in 30 days", 18)).code).toBe("strong_discount"));
  it("lowest-price basis + tiny drop = modest, not strong", () => expect(verdict(withBasis("LOWEST_PRICE", "Lowest price in 30 days", 4)).code).toBe("modest_discount"));
  it("was-price basis = likely, never claims it is the usual/regular price", () => {
    const v = verdict(withBasis("WAS_PRICE", "Was Price:", 20));
    expect(v.code).toBe("likely_discount");
    expect(v.sentence).toContain('Amazon\'s "Was Price" $299.99');
    expect(v.sentence.toLowerCase()).not.toMatch(/usually|regular/);
  });
  it("never invents a label when Amazon sent none", () => {
    const v = verdict(withBasis("LIST_PRICE", "", 25));
    expect(v.sentence).toContain("Amazon's reference price $299.99");
    expect(v.sentence).not.toContain('"');
  });
  it("list-price basis = weak evidence, quotes Amazon's label", () => {
    const v = verdict(withBasis("LIST_PRICE", "List Price", 25));
    expect(v.code).toBe("weak_evidence");
    expect(v.sentence).toContain("List Price");
    expect(v.sentence.toLowerCase()).not.toContain("fake");
  });
  it("under 3% = no discount", () => expect(verdict(withBasis("LIST_PRICE", "List Price", 2)).code).toBe("no_discount"));
  it("no price = unknown; MAP = price_hidden", () => {
    const item = base(); item.offersV2!.listings![0].price = {}; item.offersV2!.listings![0].violatesMAP = true;
    expect(verdict(toCard(item, at)!).code).toBe("price_hidden");
  });
});
