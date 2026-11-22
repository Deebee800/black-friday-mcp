// End-to-end against a running `npm run dev`: DCR → consent (one click) → PKCE token → MCP initialize + tools/list.
// Run: node scripts/local-oauth-test.mjs [base]
import { createHash, randomBytes } from "node:crypto";
const BASE = process.argv[2] ?? "http://localhost:8787";
const REDIRECT = "http://localhost:9999/cb";
const b64u = (b) => Buffer.from(b).toString("base64url");
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
const resource = prm.resource; console.log("resource:", resource);

const reg = await (await fetch(`${BASE}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ client_name: "Local test client", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) })).json();
if (!reg.client_id) fail(`register: ${JSON.stringify(reg)}`);
console.log("client_id:", reg.client_id);

const verifier = b64u(randomBytes(32));
const challenge = b64u(createHash("sha256").update(verifier).digest());
const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope: "shop:read", state: "st123", code_challenge: challenge, code_challenge_method: "S256", resource });
const page = await fetch(`${BASE}/authorize?${q}`);
const html = await page.text();
if (page.status !== 200 || !html.includes("Connect")) fail(`authorize GET ${page.status}: ${html.slice(0, 200)}`);
console.log("consent page: ok");

const post = await fetch(`${BASE}/authorize`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin" }, body: new URLSearchParams({ q: `?${q}` }) });
const loc = post.headers.get("location") ?? "";
if (post.status !== 302 || !loc.startsWith(REDIRECT)) fail(`authorize POST ${post.status}: ${loc || (await post.text()).slice(0, 200)}`);
const cb = new URL(loc);
const code = cb.searchParams.get("code"); if (!code) fail(`no code in ${loc}`);
if (cb.searchParams.get("state") !== "st123") fail("state mismatch");
console.log("redirect: ok (iss=" + cb.searchParams.get("iss") + ")");

const tok = await (await fetch(`${BASE}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier, resource }) })).json();
if (!tok.access_token) fail(`token: ${JSON.stringify(tok)}`);
console.log("token: ok (expires_in=" + tok.expires_in + ")");

const rpc = async (body, extra = {}) => {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...extra }, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { const m = text.match(/^data: (.*)$/m); if (m) json = JSON.parse(m[1]); }
  return { status: r.status, json, text };
};
const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "local-test", version: "0" } } });
if (init.status !== 200 || !init.json?.result?.serverInfo) fail(`initialize ${init.status}: ${init.text.slice(0, 300)}`);
console.log("initialize: ok →", init.json.result.serverInfo.name, "protocol", init.json.result.protocolVersion);
const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const tools = list.json?.result?.tools ?? [];
if (!tools.length) fail(`tools/list ${list.status}: ${list.text.slice(0, 300)}`);
console.log("tools:", tools.map(t => `${t.name}${t.annotations?.readOnlyHint ? " (read-only)" : ""}`).join(", "));
const bad = await fetch(`${BASE}/mcp`, { method: "POST", headers: { Authorization: "Bearer nope", "Content-Type": "application/json" }, body: "{}" });
console.log("bad token →", bad.status, bad.status === 401 ? "ok" : "UNEXPECTED");
if (process.argv.includes("--call")) {
  const asin = process.env.TEST_ASIN ?? "B09B8V1LZ3";
  const c1 = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "check_deal", arguments: { asin_or_url: asin } } });
  console.log("check_deal #1 →", c1.status, "from_cache=" + c1.json?.result?.structuredContent?.from_cache, "\n" + (c1.json?.result?.content?.[0]?.text ?? c1.text).split("\n").slice(0, 5).join("\n"));
  const c2 = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "check_deal", arguments: { asin_or_url: asin } } });
  console.log("check_deal #2 → from_cache=" + c2.json?.result?.structuredContent?.from_cache, c2.json?.result?.structuredContent?.from_cache ? "(no Amazon call) ok" : "UNEXPECTED");
  const s1 = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "search_deals", arguments: { query: "robot vacuum", max_price: 300 } } });
  const sc = s1.json?.result?.structuredContent;
  console.log("search_deals → count=" + sc?.count, "total=" + sc?.total_results, "from_cache=" + sc?.from_cache);
  console.log((s1.json?.result?.content?.[0]?.text ?? s1.text).split("\n").slice(0, 12).join("\n"));
  const urls = (sc?.products ?? []).map(p => p.url);
  console.log("links intact:", urls.every(u => /^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}\?tag=.+&linkCode=o[gs]i/.test(u)) ? "ok" : "UNEXPECTED", urls[0]);
}

const stats = async () => process.env.ADMIN_KEY ? (await (await fetch(`${BASE}/admin/stats`, { headers: { "x-admin-key": process.env.ADMIN_KEY } })).json()) : null;

if (process.argv.includes("--singleflight")) {
  const before = await stats();
  const price = 300 + Math.floor(Math.random() * 90) / 100; // unique cache key, still real results
  const N = 12;
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => rpc({ jsonrpc: "2.0", id: 100 + i, method: "tools/call", params: { name: "search_deals", arguments: { query: "robot vacuum", max_price: price } } })));
  const counts = rs.map(r => r.json?.result?.structuredContent?.count ?? "err:" + r.status);
  const after = await stats();
  const used = before && after ? after.dayCount - before.dayCount : "?";
  console.log(`singleflight: ${N} concurrent identical searches → results ${JSON.stringify([...new Set(counts)])}, Amazon calls used = ${used} ${used === 1 ? "ok" : "UNEXPECTED"}`);
}

if (process.argv.includes("--cap")) {
  const asins = ["B0GDXV2KJ4", "B0DX6KZR9T", "B0HBQR6ZHF", "B0DWFZ8Q7M", "B07R295MLS", "B0DV53XDDJ"];
  const out = [];
  for (const a of asins) {
    const r = await rpc({ jsonrpc: "2.0", id: 200, method: "tools/call", params: { name: "check_deal", arguments: { asin_or_url: a } } });
    const sc = r.json?.result?.structuredContent ?? {};
    out.push(sc.error ? `${a}:${sc.error}` : `${a}:${sc.from_cache ? "cache" : "amazon"}`);
  }
  console.log("cap test (install cap set low):", out.join("  "));
  const again = await rpc({ jsonrpc: "2.0", id: 201, method: "tools/call", params: { name: "check_deal", arguments: { asin_or_url: asins[0] } } });
  console.log("cached ASIN after cap →", again.json?.result?.structuredContent?.from_cache ? "served from cache ok" : "UNEXPECTED " + JSON.stringify(again.json?.result?.structuredContent ?? {}).slice(0, 120));
}

if (process.argv.includes("--capmin")) {
  // 13 distinct uncached searches from one install; the gate allows installPerMinuteMisses (default 10) per minute.
  const base = 300 + Math.floor(Math.random() * 50);
  const out = {};
  for (let i = 1; i <= 13; i++) {
    const r = await rpc({ jsonrpc: "2.0", id: 400 + i, method: "tools/call", params: { name: "search_deals", arguments: { query: "robot vacuum", max_price: base + i / 100 } } });
    const sc = r.json?.result?.structuredContent ?? {};
    const k = sc.error ? sc.error : sc.from_cache ? "cache" : "amazon";
    out[k] = (out[k] ?? 0) + 1;
  }
  console.log("per-minute miss cap:", JSON.stringify(out), out.rate_limited ? "ok (cut off within the minute)" : "UNEXPECTED (no rate_limited)");
}

if (process.argv.includes("--ratelimit")) {
  const rs = [];
  for (let i = 0; i < 30; i++) rs.push(await rpc({ jsonrpc: "2.0", id: 300 + i, method: "tools/list", params: {} }));
  const codes = rs.reduce((m, r) => (m[r.status] = (m[r.status] ?? 0) + 1, m), {});
  console.log("ratelimit: 30 rapid calls →", JSON.stringify(codes), codes[429] ? "ok (some 429s)" : "UNEXPECTED (no 429)");
}
if (process.argv.includes("--loopback")) {
  // Claude Code registers port-less loopback redirect URIs and then uses a random port (RFC 8252).
  const r2 = await (await fetch(`${BASE}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Loopback test", redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }) })).json();
  const port = 40000 + Math.floor(Math.random() * 20000);
  const ru = `http://127.0.0.1:${port}/callback`;
  const q2 = new URLSearchParams({ response_type: "code", client_id: r2.client_id, redirect_uri: ru, scope: "shop:read", state: "lb", code_challenge: challenge, code_challenge_method: "S256", resource });
  const g = await fetch(`${BASE}/authorize?${q2}`);
  const p2 = await fetch(`${BASE}/authorize`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin" }, body: new URLSearchParams({ q: `?${q2}` }) });
  const l2 = p2.headers.get("location") ?? "";
  console.log(`loopback random port ${port}: consent ${g.status}, redirect ${p2.status} → ${l2.startsWith(ru) && l2.includes("code=") ? "ok" : "UNEXPECTED " + l2.slice(0, 120)}`);
}

if (process.argv.includes("--one")) {
  const a = process.argv[process.argv.indexOf("--one") + 1];
  const r = await rpc({ jsonrpc: "2.0", id: 500, method: "tools/call", params: { name: "check_deal", arguments: { asin_or_url: a } } });
  const sc = r.json?.result?.structuredContent ?? {};
  console.log(`one ${a}: from_cache=${sc.from_cache} stale=${sc.stale} error=${sc.error ?? "-"} | ${(r.json?.result?.content?.[0]?.text ?? "").split("\n").slice(1, 2).join("").trim().slice(0, 90)}`);
}
if (process.argv.includes("--trending")) {
  // Default (no category) fetches the headline categories concurrently; must come back well under 5 s cold.
  const t0 = Date.now();
  const r = await rpc({ jsonrpc: "2.0", id: 600, method: "tools/call", params: { name: "get_trending_deals", arguments: {} } });
  const ms = Date.now() - t0;
  const sc = r.json?.result?.structuredContent ?? {};
  const cats = (sc.categories ?? []).map(c => `${c.label}:${c.products.length}`).join(" ");
  console.log(`trending default: ${ms}ms, ${cats || "no sections"} error=${sc.error ?? "-"} ${ms < 5000 ? "ok" : "SLOW"}`);
  const first = sc.categories?.[0]?.products?.[0];
  if (first) console.log("  first card:", JSON.stringify({ label: first.savings?.reference_label, note: first.savings?.evidence_note, pct: first.savings?.percent }));
}
if (process.argv.includes("--gift")) {
  const t0 = Date.now();
  const r = await rpc({ jsonrpc: "2.0", id: 700, method: "tools/call", params: { name: "gift_ideas", arguments: { budget: 40, ideas: ["insulated coffee mug"], recipient: "my dad" } } });
  const sc = r.json?.result?.structuredContent ?? {};
  const text = r.json?.result?.content?.[0]?.text ?? "";
  console.log(`gift: ${Date.now() - t0}ms groups=${(sc.groups ?? []).length} error=${sc.error ?? "-"} | ${text.split("\n")[0].slice(0, 80)}`);
}
if (process.argv.includes("--search")) {
  const q = process.argv[process.argv.indexOf("--search") + 1];
  const r = await rpc({ jsonrpc: "2.0", id: 800, method: "tools/call", params: { name: "search_deals", arguments: { query: q, max_price: 80 } } });
  const sc = r.json?.result?.structuredContent ?? {};
  console.log(`search "${q}": count=${sc.count ?? 0} from_cache=${sc.from_cache} error=${sc.error ?? "-"} ${sc.message ?? ""}`);
}
console.log("ALL OK");
