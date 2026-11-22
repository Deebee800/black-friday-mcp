// One-click connect: no account, no email. GET renders a page; POST mints a random install ID and completes the OAuth grant.
import { AuthorizationError, type AuthRequest } from "@cloudflare/workers-oauth-provider";

const SCOPE = "shop:read";

function page(body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Black Friday MCP</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#222}button{font:inherit;padding:12px 20px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}small{color:#666}</style></head><body>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" } });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

async function parseOrError(env: Env, request: Request): Promise<AuthRequest | Response> {
  try {
    return await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (!error.redirectUri) return page(`<h1>Can't connect</h1><p>${escapeHtml(error.description ?? error.code)}</p>`, 400);
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set("error", error.code);
    if (error.description) redirect.searchParams.set("error_description", error.description);
    if (error.state) redirect.searchParams.set("state", error.state);
    if (error.issuer) redirect.searchParams.set("iss", error.issuer);
    return Response.redirect(redirect.toString(), 302);
  }
}

export const consentHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });

    if (request.method === "GET") {
      const parsed = await parseOrError(env, request);
      if (parsed instanceof Response) return parsed;
      const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
      const clientName = escapeHtml(client?.clientName ?? "your AI assistant");
      return page(`<h1>Connect Black Friday MCP</h1>
<p>${clientName} wants to use Black Friday MCP to look up Amazon.com products, prices and deals for you.</p>
<p>No account, no email. This creates a random connection ID so we can keep the shared Amazon quota fair.</p>
<form method="post" action="/authorize"><input type="hidden" name="q" value="${escapeHtml(url.search)}"><button type="submit">Connect</button></form>
<p><small><a href="/privacy">Privacy</a> · <a href="/disclosure">Affiliate disclosure</a> · As an Amazon Associate, Black Friday MCP earns from qualifying purchases.</small></p>`);
    }

    if (request.method === "POST") {
      const site = request.headers.get("Sec-Fetch-Site");
      if (site && site !== "same-origin" && site !== "none") return page("<h1>Blocked</h1><p>Cross-site form submission.</p>", 403);
      const form = await request.formData();
      const q = String(form.get("q") ?? "");
      if (!q.startsWith("?")) return page("<h1>Can't connect</h1><p>Missing authorization request.</p>", 400);
      const parsed = await parseOrError(env, new Request(`${url.origin}/authorize${q}`, { method: "GET", headers: request.headers }));
      if (parsed instanceof Response) return parsed;
      const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
      const installId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const scope = parsed.scope.length ? parsed.scope.filter(s => s === SCOPE) : [SCOPE];
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: parsed,
        userId: installId,
        metadata: { clientName: client?.clientName ?? null, createdAt },
        scope: scope.length ? scope : [SCOPE],
        props: { installId, createdAt },
      });
      return Response.redirect(redirectTo, 302);
    }
    return new Response("Method not allowed", { status: 405 });
  },
};
