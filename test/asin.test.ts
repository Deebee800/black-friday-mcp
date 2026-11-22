import { describe, expect, it } from "vitest";
import { parseAsin } from "../src/amazon/asin";

describe("parseAsin", () => {
  it("accepts a bare ASIN", () => expect(parseAsin(" b0bshf7whw ")).toEqual({ ok: true, asin: "B0BSHF7WHW" }));
  it("rejects a 10-digit number as ASIN", () => expect(parseAsin("1234567890").ok).toBe(false));
  it("parses /dp/ URLs with junk after", () => expect(parseAsin("https://www.amazon.com/Some-Title/dp/B0BSHF7WHW/ref=sr_1_1?keywords=x")).toEqual({ ok: true, asin: "B0BSHF7WHW" }));
  it("parses /gp/product/ URLs", () => expect(parseAsin("https://amazon.com/gp/product/B09B8V1LZ3")).toEqual({ ok: true, asin: "B09B8V1LZ3" }));
  it("rejects short links", () => expect(parseAsin("https://a.co/d/abc123")).toEqual({ ok: false, reason: "short_link" }));
  it("rejects non-US marketplaces", () => expect(parseAsin("https://www.amazon.co.uk/dp/B0BSHF7WHW")).toEqual({ ok: false, reason: "non_us" }));
  it("rejects non-Amazon", () => expect(parseAsin("https://walmart.com/ip/123")).toEqual({ ok: false, reason: "not_amazon" }));
  it("rejects garbage", () => expect(parseAsin("hello there friend").ok).toBe(false));
});
