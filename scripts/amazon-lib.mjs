// Shared helpers for scripts. Node 20+, no dependencies. Uses env from .dev.vars via --env-file.
const TOKEN_URL = "https://api.amazon.com/auth/o2/token"; // NA, credential version 3.1
const API = "https://creatorsapi.amazon";

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name} in .dev.vars`); process.exit(1); }
  return v;
}

export async function getToken(clientId, clientSecret) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "creatorsapi::default" }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function call(op, body, token) {
  const res = await fetch(`${API}/catalog/v1/${op}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-marketplace": "www.amazon.com" },
    body: JSON.stringify({ marketplace: "www.amazon.com", ...body }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, headers: Object.fromEntries(res.headers), json };
}

export const ITEM_RESOURCES = [
  "itemInfo.title", "itemInfo.features", "itemInfo.byLineInfo", "itemInfo.classifications",
  "images.primary.medium", "images.primary.large",
  "offersV2.listings.price", "offersV2.listings.availability", "offersV2.listings.dealDetails",
  "offersV2.listings.type", "offersV2.listings.merchantInfo", "offersV2.listings.isBuyBoxWinner", "parentASIN",
  "browseNodeInfo.websiteSalesRank",
];
