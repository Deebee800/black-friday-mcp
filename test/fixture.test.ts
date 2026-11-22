import { describe, expect, it } from "vitest";
import sample from "../fixtures/amazon-sample.json";
import { toCard } from "../src/amazon/map";
import type { ApiItem } from "../src/amazon/types";
import { DEFAULT_CONFIG } from "../src/config";
import { cardLine, dealText } from "../src/mcp/format";
import { verdict } from "../src/mcp/verdict";

const at = "2026-09-18T03:40:00.000Z";
const items = (sample as any).searchItems.searchResult.items as ApiItem[];

describe("real Amazon fixture", () => {
  it("maps every search item to a card with an untouched vended URL", () => {
    for (const it of items) {
      const c = toCard(it, at)!;
      expect(c.url).toBe(it.detailPageURL);
      expect(c.url).toMatch(/linkCode=o[gs]i/); // ogi = item lookup, osi = search
      expect(c.price?.display).toMatch(/^\$/);
    }
  });
  it("strips the trailing colon from Amazon's reference label", () => {
    const c = toCard(items[0], at)!;
    expect(c.savings?.basisLabel).toBe("List Price:"); // verbatim, colon included
    expect(c.savings?.basisType).toBe("LIST_PRICE");
  });
  it("list-price-only savings yield weak_evidence and quote the label", () => {
    const v = verdict(toCard(items[1], at)!);
    expect(v.code).toBe("weak_evidence");
    expect(v.sentence).toContain("List Price");
  });
  it("surfaces a limited-time deal badge with its end time", () => {
    const withDeal = items.find(i => i.offersV2?.listings?.[0]?.dealDetails?.badge)!;
    const line = cardLine(toCard(withDeal, at)!, DEFAULT_CONFIG);
    expect(line).toContain('Amazon labels this "Limited time deal"');
    expect(line).toMatch(/ends .* ET/);
  });
  it("labels Prime-exclusive prices without inventing a badge", () => {
    const prime = items.find(i => i.offersV2?.listings?.[0]?.dealDetails?.accessType === "PRIME_EXCLUSIVE" && !i.offersV2?.listings?.[0]?.dealDetails?.badge)!;
    expect(dealText(toCard(prime, at)!)).toBe("Prime-exclusive price");
  });
});
