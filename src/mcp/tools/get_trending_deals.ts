import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { CATEGORIES, findCategory, type Category } from "../../categories";
import type { ProductCard } from "../../amazon/types";
import { DESCRIPTIONS } from "../descriptions";
import { cardJson, cardLine, EMPTY, errorResult, isBuyable, toolResult } from "../format";
import { lookup, type LookupOutcome } from "../lookup";
import type { ToolDeps } from "../server";

const HEADLINE = ["tvs", "headphones", "robot-vacuums"];

export const trendingInput = z.object({
  category: z.string().max(40).optional().describe(`One of: ${CATEGORIES.map(c => c.id).join(", ")}`),
  max_price: z.number().positive().max(100000).optional().describe("Budget ceiling in US dollars"),
});

function isDeal(c: ProductCard, min: number) {
  return !!c.deal?.badge || (c.savings?.percent ?? 0) >= min;
}

/** Order by how trustworthy the discount evidence is, then by depth. Amazon's "Featured" order is not a deals ranking. */
function dealRank(c: ProductCard): number {
  const t = c.savings?.basisType ?? "";
  const tier = t.startsWith("LOWEST_PRICE") ? 3 : t === "WAS_PRICE" ? 2 : t === "LIST_PRICE" ? 1 : 0;
  return (tier + (c.deal?.badge ? 1 : 0)) * 1000 + (c.savings?.percent ?? 0);
}

export async function trendingFor(deps: ToolDeps, cat: Category, maxPrice?: number, source: "user" | "prewarm" = "user"): Promise<LookupOutcome> {
  return lookup(deps.env, deps.cfg, deps.installId, {
    op: "search",
    params: { keywords: cat.keywords, searchIndex: cat.searchIndex, minSavingPercent: cat.minSavingPercent, sortBy: "Featured", maxPriceCents: maxPrice ? Math.round(maxPrice * 100) : undefined, itemCount: 10 },
  }, source);
}

export function registerTrending(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    "get_trending_deals",
    {
      title: "Trending Black Friday deals by category",
      description: DESCRIPTIONS.get_trending_deals,
      inputSchema: trendingInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const chosen = findCategory(args.category);
      if (args.category && !chosen) {
        return errorResult(`Unknown category "${args.category}". Choose one of: ${CATEGORIES.map(c => c.id).join(", ")}.`, "bad_category");
      }
      const cats = chosen ? [chosen] : HEADLINE.map(id => findCategory(id)!).filter(Boolean);
      // Concurrent: the Gate still paces Amazon calls, but wall time is one wait instead of the sum.
      const outs = await Promise.all(cats.map(cat => trendingFor(deps, cat, args.max_price)));
      const sections: string[] = [];
      const structured: Record<string, unknown>[] = [];
      let anyStale = false;
      let lastProblem: LookupOutcome["problem"];
      cats.forEach((cat, i) => {
        const out = outs[i];
        const cards = out.cards
          .filter(c => isBuyable(c) && isDeal(c, cat.minSavingPercent))
          .sort((a, b) => dealRank(b) - dealRank(a))
          .slice(0, chosen ? 8 : 4);
        anyStale ||= out.stale;
        if (out.problem) lastProblem = out.problem;
        if (!cards.length) return;
        sections.push(`${cat.label}:\n\n${cards.map((c, j) => cardLine(c, deps.cfg, j + 1)).join("\n\n")}`);
        structured.push({ category: cat.id, label: cat.label, products: cards.map(c => cardJson(c, deps.cfg)) });
      });
      if (!sections.length) {
        if (lastProblem) return errorResult(lastProblem.reason === "install_cap" ? EMPTY.installCap : lastProblem.reason === "rate_limited" ? EMPTY.rateLimited : EMPTY.amazonDown, lastProblem.reason);
        return errorResult(`No discounted in-stock items found in ${cats.map(c => c.label).join(", ")} right now.`, "no_results");
      }
      const others = CATEGORIES.filter(c => !cats.includes(c)).map(c => c.id);
      const notes = [
        chosen ? null : `Showing ${cats.map(c => c.label).join(", ")}. Other categories: ${others.join(", ")}.`,
        anyStale ? "Some results are cached because Amazon could not be reached just now (each shows its as-of time)." : null,
      ].filter((n): n is string => !!n);
      return toolResult({ products: true, text: sections.join("\n\n"), notes, structured: { categories: structured, other_categories: others, stale: anyStale } });
    },
  );
}
