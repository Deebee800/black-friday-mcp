// How results read to the assistant. Wording here is product: keep it calm, honest, and compact.
import type { ProductCard } from "../amazon/types";
import type { RuntimeConfig } from "../config";

// The associate sentence names the product, not "I": in a chat, "I" reads as the assistant earning money.
// Amazon's Operating Agreement §5 allows the required sentence "or any substantially similar statement".
export const DISCLOSURE = {
  free: "Black Friday MCP is free to use; Amazon pays it a small commission when you buy through these links, at no extra cost to you.",
  associate: "As an Amazon Associate, Black Friday MCP earns from qualifying purchases.",
  prices: "Product prices and availability are accurate as of the date/time indicated and are subject to change. Any price and availability information displayed on Amazon at the time of purchase will apply to the purchase of this product.",
  content: "CERTAIN CONTENT THAT APPEARS IN THIS APPLICATION COMES FROM AMAZON. THIS CONTENT IS PROVIDED 'AS IS' AND IS SUBJECT TO CHANGE OR REMOVAL AT ANY TIME.",
};

export const DISCLOSURE_BLOCK = `${DISCLOSURE.free} ${DISCLOSURE.associate} ${DISCLOSURE.prices} ${DISCLOSURE.content}`;

/** We cannot detect where the shopper is, so every response says this once. */
export const MARKET_NOTE = "Prices and links are for Amazon.com (US), in USD.";

export const EMPTY = {
  noResults: "No matching in-stock products right now.",
  amazonDown: "Couldn't reach Amazon just now; try again in a minute.",
  badAsin: "That doesn't look like an Amazon product link or ASIN. Paste the product page URL from amazon.com or the 10-character ASIN.",
  shortLink: "Short links (a.co, amzn.to) can't be expanded here. Open it in your browser and paste the full amazon.com product page URL instead.",
  nonUs: "Only Amazon.com (US) products are supported. Paste the amazon.com URL for this product.",
  installCap: "This connection has hit its daily limit for new Amazon lookups. Cached results still work; new lookups reset at midnight UTC.",
  rateLimited: "Too many requests from this connection in the last minute. Wait a moment and try again.",
  budget: "Amazon lookups are limited for today; showing cached results only where available.",
};

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const ET_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function asOf(iso: string): string {
  return ET.format(new Date(iso)).replace(",", "");
}

export function ageSeconds(iso: string): number {
  return Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
}

export function availabilityText(card: ProductCard): string {
  switch (card.availability) {
    case "IN_STOCK": return "In stock";
    case "IN_STOCK_SCARCE": return "Low stock";
    case "OUT_OF_STOCK": return "Out of stock";
    case "PREORDER": return "Pre-order";
    case "AVAILABLE_DATE": case "LEADTIME": return "Ships later";
    case "NO_OFFER": return "No offer shown";
    default: return "Availability unknown";
  }
}

export function isBuyable(card: ProductCard): boolean {
  return card.availability === "IN_STOCK" || card.availability === "IN_STOCK_SCARCE" || card.availability === "PREORDER";
}

/** Price with the "as of" time inline so it cannot be separated from the price. */
export function priceText(card: ProductCard): string {
  if (card.price) return `${card.price.display} (as of ${asOf(card.fetchedAt)})`;
  if (card.mapHidden) return "Amazon shows this price only in the cart";
  return "Price not shown";
}

/**
 * Amazon's own label for the reference price, for use in prose. The stored value stays verbatim
 * (see cardJson); here only a trailing colon is trimmed ("List Price:" → "List Price").
 * Returns null when Amazon sent no label — we never invent one.
 */
export function basisLabel(s: ProductCard["savings"]): string | null {
  const l = s?.basisLabel?.trim();
  return l ? l.replace(/\s*:$/, "") : null;
}

/** How the reference price reads in a sentence, always attributed to Amazon and never reworded. */
export function referenceText(s: ProductCard["savings"]): string {
  const label = basisLabel(s);
  const who = label ? `Amazon's "${label}"` : "Amazon's reference price";
  return s?.basisDisplay ? `${who} ${s.basisDisplay}` : who;
}

/** Short caveat by reference-price type so browse results tell the same story as check_deal. */
export function savingsCaveat(basisType?: string): string | null {
  const t = basisType ?? "";
  if (t.startsWith("LOWEST_PRICE")) return "a real drop from its recent price";
  if (t === "WAS_PRICE") return "likely a real discount";
  if (t === "LIST_PRICE") return "weak evidence: list prices often sit above the usual selling price";
  return null;
}

export function savingsText(card: ProductCard): string | null {
  const s = card.savings;
  if (!s?.percent || s.percent < 1) return null;
  const caveat = savingsCaveat(s.basisType);
  return `${s.percent}% off vs ${referenceText(s)}${caveat ? ` (${caveat})` : ""}`;
}

export function dealText(card: ProductCard): string | null {
  if (!card.deal) return null;
  const ends = card.deal.endsAt ? `, ends ${ET_DATE.format(new Date(card.deal.endsAt))} ET` : "";
  const prime = card.deal.accessType === "PRIME_EXCLUSIVE" ? " (Prime members only)" : "";
  if (card.deal.badge) return `Amazon labels this "${card.deal.badge}"${prime}${ends}`;
  if (card.deal.listingType === "LIGHTNING_DEAL") return `Amazon labels this "Lightning Deal"${prime}${ends}`;
  if (card.deal.accessType === "PRIME_EXCLUSIVE") return "Prime-exclusive price";
  return null;
}

export function staleNote(card: ProductCard, cfg: RuntimeConfig): string | null {
  return ageSeconds(card.fetchedAt) > cfg.staleWarnS ? "price may have changed — confirm on Amazon" : null;
}

/** Title is a markdown link so the link travels with the name when the assistant rewrites the list. URL untouched. */
export function cardLine(card: ProductCard, cfg: RuntimeConfig, index?: number, opts: { availability?: boolean } = {}): string {
  const parts = [priceText(card), savingsText(card), opts.availability === false ? null : availabilityText(card), dealText(card), staleNote(card, cfg)].filter(Boolean);
  const head = index != null ? `${index}. ` : "";
  const title = card.title.replace(/\[/g, "(").replace(/\]/g, ")");
  return `${head}[${title}](${card.url})\n   ${parts.join(" · ")}`;
}

export function cardJson(card: ProductCard, cfg: RuntimeConfig) {
  return {
    asin: card.asin,
    title: card.title,
    brand: card.brand,
    price: card.price ? { ...card.price, as_of: card.fetchedAt, display_with_time: priceText(card) } : null,
    price_hidden_until_cart: card.mapHidden ?? false,
    savings: card.savings
      ? {
          percent: card.savings.percent,
          amount: card.savings.amount,
          reference_type: card.savings.basisType,
          // Verbatim as Amazon sent it, or null. Never a label we made up.
          reference_label: card.savings.basisLabel ?? null,
          reference_price: card.savings.basisDisplay,
          evidence_note: savingsCaveat(card.savings.basisType),
        }
      : null,
    availability: card.availability,
    availability_text: availabilityText(card),
    deal: card.deal ? { badge: card.deal.badge ?? card.deal.listingType, ends_at: card.deal.endsAt, access: card.deal.accessType } : null,
    // Ratings are not available from the Creators API; the key is omitted rather than shown as null so assistants don't dwell on it.
    ...(card.rating ? { rating: card.rating } : {}),
    merchant: card.merchant ?? null,
    image_url: card.imageUrl ?? null,
    url: card.url,
    stale_note: staleNote(card, cfg),
  };
}

export interface ToolText { text: string; structured: Record<string, unknown>; isError?: boolean; products?: boolean; notes?: string[] }

export const LINK_HINT = "In your reply, give each product's link exactly as shown above.";

/** Wrap a tool response: text block the assistant should reproduce + structured JSON + one disclosure block. */
export function toolResult(r: ToolText) {
  const hint = r.products ? `${LINK_HINT} ` : "";
  const notes = r.notes?.filter(Boolean) ?? [];
  const noteText = notes.length ? `\n\n${notes.join(" ")}` : "";
  // Some clients show only structuredContent, so everything the text says is also in the JSON.
  return {
    content: [{ type: "text" as const, text: `${r.text}${noteText}\n\n${hint}${MARKET_NOTE} ${DISCLOSURE_BLOCK}` }],
    structuredContent: { ...r.structured, ...(notes.length ? { notes } : {}), ...(r.products ? { hint: LINK_HINT } : {}), disclosure: DISCLOSURE_BLOCK, market: "Amazon.com (US), USD" },
    ...(r.isError ? { isError: true } : {}),
  };
}

export function errorResult(message: string, code: string) {
  return toolResult({ text: message, structured: { error: code, message }, isError: false });
}
