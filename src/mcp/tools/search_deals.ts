import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { RuntimeConfig } from "../../config";
import { findCategory } from "../../categories";
import { DESCRIPTIONS } from "../descriptions";
import { cardJson, cardLine, EMPTY, errorResult, isBuyable, toolResult } from "../format";
import { lookup, problemMessage } from "../lookup";
import type { ToolDeps } from "../server";

export const searchInput = z.object({
  query: z.string().min(2).max(200).describe("What the shopper wants, in plain words, e.g. 'robot vacuum' or 'noise cancelling headphones'"),
  max_price: z.number().positive().max(100000).optional().describe("Budget ceiling in US dollars"),
  min_discount_percent: z.number().int().min(1).max(99).optional().describe("Only show items Amazon marks at least this percent off"),
  category: z.string().max(40).optional().describe("Optional category id from get_trending_deals to narrow the search"),
  prime_only: z.boolean().optional().describe("Only Prime-eligible items"),
});

export function registerSearchDeals(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    "search_deals",
    {
      title: "Search Amazon deals",
      description: DESCRIPTIONS.search_deals,
      inputSchema: searchInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const cfg: RuntimeConfig = deps.cfg;
      const cat = findCategory(args.category);
      const out = await lookup(deps.env, cfg, deps.installId, {
        op: "search",
        params: {
          keywords: args.query.trim(),
          maxPriceCents: args.max_price ? Math.round(args.max_price * 100) : undefined,
          minSavingPercent: args.min_discount_percent,
          searchIndex: cat?.searchIndex,
          primeOnly: args.prime_only,
          itemCount: 10,
        },
      });
      // Amazon does not reliably honour minSavingPercent, so enforce it here too.
      const minPct = args.min_discount_percent;
      const cards = out.cards.filter(c => isBuyable(c) && (!minPct || (c.savings?.percent ?? 0) >= minPct)).slice(0, 8);
      const cond = `${args.max_price ? ` under $${args.max_price}` : ""}${minPct ? ` with at least ${minPct}% off` : ""}`;
      if (!cards.length) {
        if (out.problem) return errorResult(problemMessage(out.problem, EMPTY), out.problem.reason);
        return errorResult(minPct && out.cards.some(isBuyable) ? `No in-stock "${args.query.trim()}" results${cond} right now; try a lower discount threshold.` : EMPTY.noResults, "no_results");
      }
      const lines = cards.map((c, i) => cardLine(c, cfg, i + 1));
      const notes: string[] = [];
      if (cards.length < 3) notes.push(`Only ${cards.length} in-stock match${cards.length === 1 ? "" : "es"}${cond} right now.`);
      if (args.prime_only) notes.push("Filtered to Prime-eligible items by Amazon's search filter; the Creators API does not report Prime eligibility per item, so confirm on the product page.");
      if (out.stale) notes.push("Amazon could not be reached just now; these are the most recent cached results (each shows its own as-of time).");
      const text = `${cards.length} in-stock result${cards.length === 1 ? "" : "s"} for "${args.query.trim()}"${cond}:\n\n${lines.join("\n\n")}`;
      return toolResult({ products: true,
        text,
        notes,
        structured: { query: args.query.trim(), max_price: args.max_price ?? null, min_discount_percent: minPct ?? null, count: cards.length, total_results: out.totalResults ?? null, from_cache: out.fromCache, stale: out.stale, products: cards.map(c => cardJson(c, cfg)) },
      });
    },
  );
}
