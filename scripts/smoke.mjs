// Smoke test: token + getItems on a few ASINs + one searchItems. Saves raw responses to fixtures/raw (gitignored).
// Run: npm run smoke   (reads .dev.vars)
import { mkdirSync, writeFileSync } from "node:fs";
import { requireEnv, getToken, call, ITEM_RESOURCES } from "./amazon-lib.mjs";

const clientId = requireEnv("AMAZON_CLIENT_ID");
const clientSecret = requireEnv("AMAZON_CLIENT_SECRET");
const partnerTag = requireEnv("AMAZON_PARTNER_TAG");
const asins = (process.argv[2] ?? "B0BSHF7WHW,B09B8V1LZ3,B0CX23V2ZK").split(",").map(s => s.trim()).filter(Boolean);

mkdirSync("fixtures/raw", { recursive: true });
const t0 = Date.now();
const tok = await getToken(clientId, clientSecret);
console.log(`token ok: expires_in=${tok.expires_in}s, type=${tok.token_type}, prefix=${String(tok.access_token).slice(0, 4)}… (${Date.now() - t0} ms)`);

const items = await call("getItems", { partnerTag, itemIds: asins, itemIdType: "ASIN", resources: ITEM_RESOURCES }, tok.access_token);
writeFileSync("fixtures/raw/getItems.json", JSON.stringify(items, null, 2));
console.log(`getItems status=${items.status}`);
const list = items.json?.itemsResult?.items ?? items.json?.itemsResult ?? items.json;
if (Array.isArray(list)) {
  for (const it of list) {
    const l = it.offersV2?.listings?.[0];
    console.log(`- ${it.asin} | ${it.itemInfo?.title?.displayValue?.slice(0, 60)}`);
    console.log(`  price=${l?.price?.money?.displayAmount} basis=${l?.price?.savingBasis?.savingBasisType}/${l?.price?.savingBasis?.savingBasisTypeLabel}=${l?.price?.savingBasis?.money?.displayAmount} savings=${l?.price?.savings?.percentage}% avail=${l?.availability?.type} deal=${l?.dealDetails?.badge ?? "-"} type=${l?.type ?? "-"} MAP=${l?.violatesMAP}`);
    console.log(`  reviews=${JSON.stringify(it.customerReviews)} url=${it.detailPageURL}`);
  }
} else {
  console.log(JSON.stringify(items.json).slice(0, 800));
}

const search = await call("searchItems", { partnerTag, keywords: "robot vacuum", maxPrice: 30000, itemCount: 10, availability: "Available", resources: ITEM_RESOURCES }, tok.access_token);
writeFileSync("fixtures/raw/searchItems.json", JSON.stringify(search, null, 2));
const found = search.json?.searchResult?.items ?? [];
console.log(`searchItems status=${search.status} total=${search.json?.searchResult?.totalResultCount} returned=${found.length}`);
for (const it of found.slice(0, 5)) {
  const l = it.offersV2?.listings?.[0];
  console.log(`- ${it.asin} ${l?.price?.money?.displayAmount ?? "n/a"} ${it.itemInfo?.title?.displayValue?.slice(0, 60)}`);
}
console.log("raw responses saved to fixtures/raw/ (gitignored). Rate headers:", Object.fromEntries(Object.entries(search.headers).filter(([k]) => /rate|limit|retry/i.test(k))));
