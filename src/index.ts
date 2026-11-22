import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpEntrypoint } from "./mcp/entry";
import { consentHandler } from "./oauth/consent";
import { gateStub } from "./mcp/lookup";
export { Gate } from "./gate";

const SCOPES = ["shop:read"];
/** Public half of the key that proves blackfridaymcp.com to the official MCP Registry (private half: .dev.vars MCP_REGISTRY_PRIVATE_KEY). */
const MCP_REGISTRY_AUTH = "v=MCPv1; k=ed25519; p=MGfS5LIXgVV5Oz90TNVW1BM5eyPwPYWeBR7k+ZtbdpY=";
let provider: OAuthProvider<Env> | null = null;

function getProvider(env: Env): OAuthProvider<Env> {
  if (provider) return provider;
  const origin = env.PUBLIC_ORIGIN.replace(/\/$/, "");
  provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: McpEntrypoint as any,
    defaultHandler: consentHandler as any,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: SCOPES,
    resourceMetadata: {
      resource: `${origin}/mcp`,
      // The library requires HTTPS here; for local `wrangler dev` it derives the issuer from the request instead.
      ...(origin.startsWith("https://") ? { authorization_servers: [origin] } : {}),
      scopes_supported: SCOPES,
      resource_name: "Black Friday MCP",
    },
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 60 * 60 * 24 * 30,
  });
  return provider;
}

/** Admin key comes only from the x-admin-key header (never the URL, which logs record) and is compared in constant time. */
async function adminOk(request: Request, env: Env): Promise<boolean> {
  const given = request.headers.get("x-admin-key") ?? "";
  if (!env.ADMIN_KEY || !given) return false;
  const enc = new TextEncoder();
  const a = await crypto.subtle.digest("SHA-256", enc.encode(given));
  const b = await crypto.subtle.digest("SHA-256", enc.encode(env.ADMIN_KEY));
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname === "/.well-known/mcp-registry-auth") return new Response(MCP_REGISTRY_AUTH, { headers: { "Content-Type": "text/plain" } });
    if (url.pathname === "/admin/stats") {
      if (!(await adminOk(request, env))) return new Response("forbidden", { status: 403 });
      const stats = await gateStub(env).stats();
      return Response.json({ ...stats, now: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    return getProvider(env).fetch(request, env, ctx);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(getProvider(env).purgeExpiredData(env, { batchSize: 100 }).catch((e: unknown) => console.error("purge", e)));
    ctx.waitUntil(
      gateStub(env).prewarm()
        .then((r) => console.log(JSON.stringify({ t: "prewarm", ...r })))
        .catch((e: unknown) => console.error("prewarm", e)),
    );
  },
} satisfies ExportedHandler<Env>;
