// Minimal shapes of the Amazon Creators API responses we read, plus our normalised ProductCard.

export interface Money { amount?: number; currency?: string; displayAmount?: string }

export interface Listing {
  price?: {
    money?: Money;
    savingBasis?: { money?: Money; savingBasisType?: string; savingBasisTypeLabel?: string };
    savings?: { money?: Money; percentage?: number };
  };
  availability?: { type?: string; message?: string; minOrderQuantity?: number; maxOrderQuantity?: number };
  dealDetails?: { accessType?: string; badge?: string; startTime?: string; endTime?: string; percentClaimed?: number };
  type?: string;
  merchantInfo?: { id?: string; name?: string };
  isBuyBoxWinner?: boolean;
  violatesMAP?: boolean;
}

export interface ApiItem {
  asin: string;
  detailPageURL?: string;
  parentASIN?: string;
  itemInfo?: {
    title?: { displayValue?: string };
    features?: { displayValues?: string[] };
    byLineInfo?: { brand?: { displayValue?: string } };
    classifications?: { productGroup?: { displayValue?: string }; binding?: { displayValue?: string } };
  };
  images?: { primary?: { medium?: { url?: string; height?: number; width?: number }; large?: { url?: string } } };
  offersV2?: { listings?: Listing[] };
  customerReviews?: { count?: number; starRating?: { value?: number } } | null;
  browseNodeInfo?: { websiteSalesRank?: { salesRank?: number; contextFreeName?: string } };
}

export interface ApiError { code?: string; message?: string; __type?: string }

export interface GetItemsResponse { itemsResult?: { items?: ApiItem[] }; errors?: ApiError[] }
export interface SearchItemsResponse {
  searchResult?: { items?: ApiItem[]; totalResultCount?: number; searchURL?: string };
  errors?: ApiError[];
}

export type Availability =
  | "IN_STOCK" | "IN_STOCK_SCARCE" | "OUT_OF_STOCK" | "PREORDER" | "AVAILABLE_DATE"
  | "LEADTIME" | "UNAVAILABLE" | "UNKNOWN" | "NO_OFFER";

/** What we store and show. Only displayed fields; never image bytes. */
export interface ProductCard {
  asin: string;
  title: string;
  /** detailPageURL exactly as returned by the API. Never modified. */
  url: string;
  imageUrl?: string;
  brand?: string;
  price?: { amount: number; currency: string; display: string };
  savings?: {
    amount?: number;
    percent?: number;
    /** LIST_PRICE | WAS_PRICE | LOWEST_PRICE | LOWEST_PRICE_STRIKETHROUGH */
    basisType?: string;
    /** Amazon's own label, shown verbatim (e.g. "List Price", "Was") */
    basisLabel?: string;
    basisDisplay?: string;
  };
  availability: Availability;
  deal?: { badge?: string; endsAt?: string; accessType?: string; listingType?: string };
  merchant?: string;
  /** Price hidden by Amazon (shown only in cart) */
  mapHidden?: boolean;
  rating?: { stars?: number; count?: number };
  /** ISO timestamp of the Amazon fetch this card came from */
  fetchedAt: string;
}

export interface SearchParams {
  keywords: string;
  maxPriceCents?: number;
  minPriceCents?: number;
  minSavingPercent?: number;
  minReviewsRating?: number;
  searchIndex?: string;
  browseNodeId?: string;
  sortBy?: "Relevance" | "Featured" | "NewestArrivals" | "Price:LowToHigh" | "Price:HighToLow" | "AvgCustomerReviews";
  primeOnly?: boolean;
  itemCount?: number;
  itemPage?: number;
}
