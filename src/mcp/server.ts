import { McpServer } from "@modelcontextprotocol/server";
import type { RuntimeConfig } from "../config";
import { registerSearchDeals } from "./tools/search_deals";
import { registerCheckDeal } from "./tools/check_deal";
import { registerTrending } from "./tools/get_trending_deals";
import { registerGiftIdeas } from "./tools/gift_ideas";

export interface ToolDeps { env: Env; cfg: RuntimeConfig; installId: string }

export const SERVER_INFO = { name: "blackfridaymcp", version: "0.1.0", title: "Black Friday MCP" };

export function buildServer(deps: ToolDeps): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: "Shopping helper for US shoppers on Amazon.com. When you present products from these tools, give each product's Amazon link exactly as returned (never shortened, rewritten, or replaced with a search link) next to its name, show its price with the as-of time, and include the disclosure line once per answer. If a tool says it could not fetch, say so; never invent products or prices. Star ratings and review counts are not available from this source; do not guess them.",
  });
  registerSearchDeals(server, deps);
  registerCheckDeal(server, deps);
  registerTrending(server, deps);
  registerGiftIdeas(server, deps);
  return server;
}
