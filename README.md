# Black Friday MCP

A free remote MCP server. Your AI assistant searches live Amazon.com (US) prices and deals and checks whether a discount is real.

- Server URL: `https://blackfridaymcp.com/mcp`
- Website and setup guides: https://blackfridaymcp.com
- No account, no API key. Connect once with one-click OAuth.

## Tools
All four are read-only.

| Tool | What it does |
|---|---|
| `search_deals` | Live prices and discounts for a shopping question, in-stock items only |
| `check_deal` | One product: current price, Amazon's reference price and its type, and a plain verdict on how strong the discount evidence is |
| `get_trending_deals` | Discounted in-stock items in a category, ranked by how trustworthy the discount evidence is |
| `gift_ideas` | Turns 1–3 gift ideas into in-stock picks under a per-gift budget |

Full input schemas: https://blackfridaymcp.com/developers

## How it works
- Cloudflare Workers, TypeScript, `agents` (`createMcpHandler`), Streamable HTTP, stateless.
- OAuth 2.1 via `@cloudflare/workers-oauth-provider`: dynamic client registration, client ID metadata documents, PKCE. Consent mints an anonymous install ID.
- One Durable Object (`Gate`) is the only caller of the Amazon Creators API: pacing, daily budget, per-install caps, request coalescing.
- KV cache: results up to 24 hours, offers 1 hour. No price history, no image bytes, Amazon URLs passed through untouched.

## Data and money
Amazon.com (US) only, prices in USD, from the Amazon Creators API. Free to use. As an Amazon Associate, Black Friday MCP earns from qualifying purchases. Not affiliated with Amazon.

Privacy: https://blackfridaymcp.com/privacy

## Develop
```
cp .dev.vars.example .dev.vars   # Amazon Creators API credentials (never commit)
npm install
npm test
npm run typecheck
npm run dev                                  # local HTTPS on 127.0.0.1:8787 (self-signed)
npm run test:e2e -- https://127.0.0.1:8787   # DCR → consent → PKCE token → initialize → tools/list
npm run smoke                                # live Amazon token + a few lookups
```
Runtime config (no redeploy): KV key `config` in `CACHE_KV`; keys and defaults in `src/config.ts`.
