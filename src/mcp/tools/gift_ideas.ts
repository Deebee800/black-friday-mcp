import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { DESCRIPTIONS } from "../descriptions";
import { cardJson, cardLine, EMPTY, errorResult, isBuyable, toolResult } from "../format";
import { lookup, type LookupOutcome } from "../lookup";
import type { ToolDeps } from "../server";

export const giftInput = z.object({
  budget: z.number().positive().max(100000).describe("Maximum price per gift (each item), in US dollars"),
  ideas: z.array(z.string().min(2).max(100)).min(1).max(3).describe("1–3 specific gift ideas to search, e.g. ['insulated coffee mug', 'beginner watercolor set']"),
  recipient: z.string().max(60).optional().describe("Who it's for, e.g. 'my dad who likes hiking'"),
  occasion: z.string().max(40).optional().describe("e.g. 'Christmas', 'birthday'"),
});

export function registerGiftIdeas(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    "gift_ideas",
    {
      title: "Gift picks under a budget",
      description: DESCRIPTIONS.gift_ideas,
      inputSchema: giftInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const sections: string[] = [];
      const structured: Record<string, unknown>[] = [];
      let anyStale = false;
      let lastProblem: LookupOutcome["problem"];
      for (const idea of args.ideas) {
        const out = await lookup(deps.env, deps.cfg, deps.installId, {
          op: "search",
          params: { keywords: idea.trim(), maxPriceCents: Math.round(args.budget * 100), itemCount: 10 },
        });
        anyStale ||= out.stale;
        if (out.problem) lastProblem = out.problem;
        const cards = out.cards.filter(isBuyable).slice(0, 3);
        if (!cards.length) { sections.push(`${idea.trim()}: nothing in stock at $${args.budget} or less right now.`); continue; }
        sections.push(`${idea.trim()}:\n\n${cards.map((c, i) => cardLine(c, deps.cfg, i + 1)).join("\n\n")}`);
        structured.push({ idea: idea.trim(), products: cards.map(c => cardJson(c, deps.cfg)) });
      }
      if (!structured.length && lastProblem) {
        return errorResult(lastProblem.reason === "install_cap" ? EMPTY.installCap : lastProblem.reason === "rate_limited" ? EMPTY.rateLimited : EMPTY.amazonDown, lastProblem.reason);
      }
      const who = args.recipient ? ` for ${args.recipient}` : "";
      const occ = args.occasion ? ` (${args.occasion})` : "";
      const text = `Gift picks${who}${occ}, up to $${args.budget} each:\n\n${sections.join("\n\n")}`;
      const notes = anyStale ? ["Some results are cached because Amazon could not be reached just now (each shows its as-of time)."] : [];
      return toolResult({ products: true, text, notes, structured: { budget: args.budget, recipient: args.recipient ?? null, occasion: args.occasion ?? null, groups: structured, stale: anyStale } });
    },
  );
}
