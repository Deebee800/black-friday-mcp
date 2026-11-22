// Protected /mcp entrypoint. The OAuth provider validates the bearer token and hands us ctx.props.
import { WorkerEntrypoint } from "cloudflare:workers";
import { createMcpHandler } from "agents/mcp/server";
import { loadConfig } from "../config";
import { toolCalls } from "../usage";
import { gateStub } from "./lookup";
import { buildServer } from "./server";

export interface AuthProps { installId: string; createdAt?: string }

/** Host allow-list for the MCP handler. Pinned to the public domain; the workers.dev preview host only when actually served there. */
function allowedHost(request: Request, env: Env): string[] {
  const host = new URL(request.url).hostname;
  const publicHost = new URL(env.PUBLIC_ORIGIN).hostname;
  if (/^blackfridaymcp\.[a-z0-9-]+\.workers\.dev$/.test(host)) return [host];
  return [publicHost];
}

export class McpEntrypoint extends WorkerEntrypoint<Env, AuthProps> {
  async fetch(request: Request): Promise<Response> {
    // Per-install per-minute limit (hits and misses). Approximate, per-colo, cheap.
    const installId = this.ctx.props?.installId ?? "anon";
    if (request.method === "POST") {
      const rl = await this.env.INSTALL_RL.limit({ key: installId });
      if (!rl.success) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests from this connection; wait a minute." }, id: null }), {
          status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" },
        });
      }
      // Daily usage totals for /admin/stats. Clone before the handler reads the body; the read and track() run
      // in the background, so the tool call never waits and an aborted upload can't throw out of fetch().
      if (installId !== "anon") {
        const copy = request.clone();
        this.ctx.waitUntil(
          copy.text()
            .then((body) => gateStub(this.env).track(installId, toolCalls(body)))
            .catch((e: unknown) => console.error("track", (e as Error)?.message ?? e)),
        );
      }
    }
    const cfg = await loadConfig(this.env.CACHE_KV);
    const env = this.env;
    const handler = createMcpHandler(() => buildServer({ env, cfg, installId }), {
      route: "/mcp",
      allowedHostnames: allowedHost(request, env),
      legacy: "stateless",
      authContext: { props: { installId } },
      onerror: (e) => console.error("mcp error", e?.message ?? e),
    });
    return handler(request, env, this.ctx);
  }
}
