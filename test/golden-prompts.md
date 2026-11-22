# Golden prompts — manual routing and quality check

Run each in a client with the connector attached. Expected tool in brackets. Note what the assistant actually called and whether the price "as of" time and the disclosure line appeared.

1. "best robot vacuum under $300" → [search_deals]
2. "is this a good deal? https://www.amazon.com/dp/B0DX6KZR9T" → [check_deal]
3. "B09B8V1LZ3 worth it right now?" → [check_deal]
4. "what black friday deals are on for headphones" → [get_trending_deals category=headphones]
5. "what's trending" → [get_trending_deals, no category]
6. "gift for my dad who likes hiking, $60 max" → assistant proposes 1–3 ideas, then [gift_ideas]
7. "cheapest 65 inch TV with at least 20% off" → [search_deals min_discount_percent=20]
8. "https://a.co/d/abc123 real discount?" → [check_deal] → should ask for the full amazon.com link
9. "find me an air fryer, prime only, under 100" → [search_deals prime_only=true max_price=100]
10. "compare prices for the roomba 105 at walmart and target" → assistant should say only Amazon.com is supported (no tool, or search_deals)

Quality checks per answer: prices show "(as of …)", links are amazon.com/dp/… with tag=bfmcp-serv-20, "As an Amazon Associate, Black Friday MCP earns from qualifying purchases." appears once, no invented products, verdict sentence repeated as given.

Results 2026-09-18 (five fresh Opus 4.8 agents via the live connector, Claude Code): 10/10 routed to the expected tool with sensible arguments; links tagged, as-of times and one disclosure block every time. Fixed afterwards: min_discount_percent now enforced server-side (Amazon ignored it), prime_only results carry a note (the API has no per-item Prime field; probed 2026-09-18, no delivery resource exists), notes/hint duplicated into structuredContent (some clients show only the JSON), rating key omitted (never available). Open decision: a.co short links (the Amazon app's default share format) are refused by design; resolving them needs one redirect-following request to Amazon outside the API.
