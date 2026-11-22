// Tool descriptions are the product's UI for the assistant. Each states purpose, when to use, when not to, one example,
// and asks for the link in the reply (assistants otherwise summarize without it).
export const DESCRIPTIONS = {
  search_deals: `Live Amazon.com prices and discounts for a shopping question, in-stock items only.
Use whenever the shopper wants to buy something and mentions a budget, price, deal, discount, sale, Black Friday, Cyber Monday, or Amazon ("robot vacuum under $300", "cheapest decent air fryer", "any deal on AirPods?"). Prefer this over web search for what something costs on Amazon right now.
Do not use to judge whether one specific product's discount is real (use check_deal), to browse a whole category's deals (use get_trending_deals), or for gift brainstorming across several ideas (use gift_ideas).
In your reply, give each product's Amazon link exactly as returned next to its name, show its price with the "as of" time, and include the disclosure line once.`,
  check_deal: `Check one specific Amazon.com product: current price, Amazon's own reference price and what kind it is (List Price, Was Price, Lowest recent price), the percent off, deal badge, and availability, with a plain-English verdict on how strong the discount evidence is.
Use when the shopper pastes an Amazon link or ASIN, or asks "is this a real deal / good price / worth it".
Do not use for searching by product type (use search_deals). Accepts amazon.com product URLs or a 10-character ASIN; a.co short links cannot be expanded.
Repeat the verdict sentence as given, do not restate Amazon's reference price with different words, and give the product's link exactly as returned.`,
  get_trending_deals: `Discounted, in-stock products in a Black Friday category: TVs, headphones, laptops, tablets, smart home, robot vacuums, kitchen, air fryers, toys, gaming, beauty, tools, fitness, baby, fashion.
Use when the shopper asks what deals are on, what's trending, what's worth buying right now, or wants to browse a category without a specific product in mind.
Do not use for a specific product question (use search_deals or check_deal). Without a category it returns a few headline categories.
In your reply, give each product's Amazon link exactly as returned next to its name, and include the disclosure line once.`,
  gift_ideas: `Turn 1–3 gift ideas into concrete in-stock Amazon.com picks, grouped by idea, each at or under a per-gift budget (the budget applies to each item, not the total).
Use when the shopper asks what to get someone; first come up with 1–3 specific product ideas that fit the person (e.g. "insulated coffee mug", "beginner watercolor set"), then call this once with those ideas and the budget.
Do not use for a single product query (use search_deals) or to verify a discount (use check_deal).
In your reply, give each pick's Amazon link exactly as returned next to its name, and include the disclosure line once.`,
} as const;
