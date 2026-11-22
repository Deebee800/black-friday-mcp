import type { ApiItem, Availability, ProductCard } from "./types";

const AVAIL = new Set<Availability>(["IN_STOCK", "IN_STOCK_SCARCE", "OUT_OF_STOCK", "PREORDER", "AVAILABLE_DATE", "LEADTIME", "UNAVAILABLE", "UNKNOWN"]);

/** Map an API item to the card we store and show. Keeps only displayed fields. URL is untouched. */
export function toCard(item: ApiItem, fetchedAt: string): ProductCard | null {
  if (!item?.asin || !item.detailPageURL) return null;
  const listing = item.offersV2?.listings?.find(l => l.isBuyBoxWinner) ?? item.offersV2?.listings?.[0];
  const money = listing?.price?.money;
  const basis = listing?.price?.savingBasis;
  const sav = listing?.price?.savings;
  const availRaw = listing?.availability?.type as Availability | undefined;
  const availability: Availability = listing ? (availRaw && AVAIL.has(availRaw) ? availRaw : "UNKNOWN") : "NO_OFFER";
  const card: ProductCard = {
    asin: item.asin,
    title: item.itemInfo?.title?.displayValue?.trim() || item.asin,
    url: item.detailPageURL,
    imageUrl: item.images?.primary?.medium?.url,
    brand: item.itemInfo?.byLineInfo?.brand?.displayValue,
    availability,
    fetchedAt,
  };
  if (money?.amount != null) {
    card.price = { amount: money.amount, currency: money.currency ?? "USD", display: money.displayAmount ?? `$${money.amount.toFixed(2)}` };
  } else if (listing?.violatesMAP) {
    card.mapHidden = true;
  }
  if (sav?.percentage || basis?.money?.amount != null) {
    card.savings = {
      amount: sav?.money?.amount,
      percent: sav?.percentage,
      basisType: basis?.savingBasisType,
      basisLabel: basis?.savingBasisTypeLabel, // verbatim; trimmed only for prose in format.ts
      basisDisplay: basis?.money?.displayAmount,
    };
  }
  if (listing?.dealDetails?.badge || listing?.type === "LIGHTNING_DEAL" || listing?.dealDetails?.accessType === "PRIME_EXCLUSIVE") {
    card.deal = {
      badge: listing.dealDetails?.badge,
      endsAt: listing.dealDetails?.endTime,
      accessType: listing.dealDetails?.accessType,
      listingType: listing.type,
    };
  }
  if (listing?.merchantInfo?.name) card.merchant = listing.merchantInfo.name;
  const stars = item.customerReviews?.starRating?.value;
  const count = item.customerReviews?.count;
  if (stars != null || count != null) card.rating = { stars: stars ?? undefined, count: count ?? undefined };
  return card;
}
