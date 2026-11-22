export type AsinParse =
  | { ok: true; asin: string }
  | { ok: false; reason: "short_link" | "not_amazon" | "no_asin" | "non_us" };

const ASIN_RE = /^[A-Z0-9]{10}$/;
const PATH_RE = /\/(?:dp|gp\/product|gp\/aw\/d|product|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?#]|$)/i;

/** Accepts a bare ASIN or an amazon.com product URL. Rejects a.co / amzn.to short links (cannot be expanded under Associates rules). */
export function parseAsin(input: string): AsinParse {
  const s = input.trim();
  if (ASIN_RE.test(s.toUpperCase()) && !/^\d{10}$/.test(s)) return { ok: true, asin: s.toUpperCase() };
  let url: URL;
  try { url = new URL(s.startsWith("http") ? s : `https://${s}`); } catch { return { ok: false, reason: "no_asin" }; }
  const host = url.hostname.toLowerCase();
  if (host === "a.co" || host === "amzn.to" || host === "amzn.com" || host.endsWith(".a.co")) return { ok: false, reason: "short_link" };
  if (!/(^|\.)amazon\./.test(host)) return { ok: false, reason: "not_amazon" };
  if (!/amazon\.com$/.test(host)) return { ok: false, reason: "non_us" };
  const m = url.pathname.match(PATH_RE);
  if (m) return { ok: true, asin: m[1].toUpperCase() };
  const q = url.searchParams.get("asin") ?? url.searchParams.get("ASIN");
  if (q && ASIN_RE.test(q.toUpperCase())) return { ok: true, asin: q.toUpperCase() };
  return { ok: false, reason: "no_asin" };
}
