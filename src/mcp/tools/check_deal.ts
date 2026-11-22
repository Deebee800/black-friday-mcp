import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { parseAsin } from "../../amazon/asin";
import { DESCRIPTIONS } from "../descriptions";
import { availabilityText, cardJson, cardLine, EMPTY, errorResult, toolResult } from "../format";
import { lookup, problemMessage } from "../lookup";
import type { ToolDeps } from "../server";
import { verdict } from "../verdict";

export const checkInput = z.object({
  asin_or_url: z.string().min(10).max(2000).describe("An amazon.com product page URL or a 10-character ASIN"),
});

export function registerCheckDeal(server: McpServer, deps: ToolDeps) {
  server.registerTool(
    "check_deal",
    {
      title: "Check an Amazon deal",
      description: DESCRIPTIONS.check_deal,
      inputSchema: checkInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const parsed = parseAsin(args.asin_or_url);
      if (!parsed.ok) {
        const msg = parsed.reason === "short_link" ? EMPTY.shortLink : parsed.reason === "non_us" ? EMPTY.nonUs : EMPTY.badAsin;
        return errorResult(msg, parsed.reason);
      }
      const out = await lookup(deps.env, deps.cfg, deps.installId, { op: "items", asins: [parsed.asin] });
      const card = out.cards[0];
      if (!card) {
        if (out.problem) return errorResult(problemMessage(out.problem, EMPTY), out.problem.reason);
        return errorResult(`No Amazon.com listing found for ${parsed.asin}.`, "no_results");
      }
      const v = verdict(card);
      // Availability leads and appears once; the card line below omits it.
      const lines = [
        `Availability: ${availabilityText(card)}.`,
        cardLine(card, deps.cfg, undefined, { availability: false }),
        `Verdict: ${v.sentence}`,
      ];
      if (out.stale) lines.push("Amazon could not be reached just now; this is the most recent cached price (see its as-of time).");
      return toolResult({ products: true,
        text: lines.join("\n"),
        structured: { asin: card.asin, verdict: v.code, verdict_text: v.sentence, evidence: v.evidence, from_cache: out.fromCache, stale: out.stale, product: cardJson(card, deps.cfg) },
      });
    },
  );
}
