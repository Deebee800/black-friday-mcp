// check_deal verdict: depends on BOTH the reference-price type and the percent off.
// Repeats Amazon's label; never says "fake"; never rewrites a List Price or Was Price as the "usual" or "regular" price.
import type { ProductCard } from "../amazon/types";
import { dealText, referenceText } from "./format";

export type VerdictCode = "strong_discount" | "likely_discount" | "modest_discount" | "weak_evidence" | "no_discount" | "price_hidden" | "unknown";

export interface Verdict { code: VerdictCode; sentence: string; evidence: string }

export function verdict(card: ProductCard): Verdict {
  if (!card.price) {
    return card.mapHidden
      ? { code: "price_hidden", sentence: "Amazon shows this price only in the cart, so there is nothing to compare here.", evidence: "no displayed price" }
      : { code: "unknown", sentence: "No price is shown for this item right now.", evidence: "no offer" };
  }
  const s = card.savings;
  const p = s?.percent ?? 0;
  const ref = referenceText(s);
  const deal = dealText(card);
  const tail = deal ? ` ${deal}.` : "";
  if (!s || p < 3) {
    return { code: "no_discount", sentence: `No meaningful discount shown by Amazon right now (${p ? `${p}% off ${ref}` : "no reference price"}).${tail}`, evidence: "savings under 3%" };
  }
  const t = s.basisType ?? "";
  if (t.startsWith("LOWEST_PRICE")) {
    if (p >= 10) return { code: "strong_discount", sentence: `Amazon marks this ${p}% below ${ref}, the lowest it has sold for recently — a real drop.${tail}`, evidence: `lowest-price basis, ${p}%` };
    return { code: "modest_discount", sentence: `Amazon marks this ${p}% below ${ref}, the lowest it has sold for recently — a small but real drop.${tail}`, evidence: `lowest-price basis, ${p}%` };
  }
  if (t === "WAS_PRICE") {
    if (p >= 15) return { code: "likely_discount", sentence: `${p}% below ${ref}, Amazon's own reference for this item — a likely real discount.${tail}`, evidence: `was-price basis, ${p}%` };
    return { code: "modest_discount", sentence: `${p}% below ${ref}, Amazon's own reference for this item — a modest discount.${tail}`, evidence: `was-price basis, ${p}%` };
  }
  if (t === "LIST_PRICE") {
    return { code: "weak_evidence", sentence: `${p}% below ${ref}. List prices often sit above the usual selling price, so treat this as weak evidence of a real discount.${tail}`, evidence: `list-price basis, ${p}%` };
  }
  return { code: "modest_discount", sentence: `${p}% below ${ref}.${tail}`, evidence: `${t || "unknown"} basis, ${p}%` };
}
