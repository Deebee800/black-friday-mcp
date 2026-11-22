// Daily usage counts for /admin/stats: totals only. No query text, no raw install IDs.
// An install is counted once per UTC day through a day-salted hash that the gate deletes at the first cron tick of the next day.

export const KNOWN_TOOLS = ["search_deals", "check_deal", "get_trending_deals", "gift_ideas"] as const;
export const USAGE_KEEP_DAYS = 35;

/** Tool names called in a JSON-RPC body (single message or batch). Unknown names count as "other" so storage keys stay bounded. */
export function toolCalls(body: string): string[] {
  let msg: unknown;
  try { msg = JSON.parse(body); } catch { return []; }
  const msgs = Array.isArray(msg) ? msg : [msg];
  return msgs
    .filter((m): m is { method: string; params: { name: unknown } } => !!m && typeof m === "object" && (m as any).method === "tools/call")
    .slice(0, 20)
    .map(m => ((KNOWN_TOOLS as readonly string[]).includes(m.params?.name as string) ? (m.params.name as string) : "other"));
}

/** Seen-today bits for one install: 1 = sent any request, 2 = called a tool. */
export const SEEN_ANY = 1;
export const SEEN_TOOL = 2;

export interface TrackDelta { mask: number; connected: number; users: number }

/** How one request changes today's distinct counts, given what we had already seen from this install today. */
export function trackDelta(seen: number, toolCount: number): TrackDelta {
  const mask = seen | SEEN_ANY | (toolCount > 0 ? SEEN_TOOL : 0);
  return {
    mask,
    connected: seen & SEEN_ANY ? 0 : 1,
    users: mask & SEEN_TOOL && !(seen & SEEN_TOOL) ? 1 : 0,
  };
}

/** Short day-salted hash of the install ID. Not linkable across days in storage. */
export async function dayHash(installId: string, day: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${day}:${installId}`));
  return [...new Uint8Array(d).slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export interface DayUsage { day: string; connected: number; users: number; toolCalls: number; tools: Record<string, number> }

/** Folds stored "s:<day>:<metric>" counters into one row per day, newest first. */
export function foldUsage(entries: Iterable<[string, number]>): DayUsage[] {
  const days = new Map<string, DayUsage>();
  for (const [k, v] of entries) {
    const [, day, metric, tool] = k.split(":");
    if (!day || !metric) continue;
    const row = days.get(day) ?? { day, connected: 0, users: 0, toolCalls: 0, tools: {} };
    if (metric === "connected") row.connected = v;
    else if (metric === "users") row.users = v;
    else if (metric === "tool" && tool) { row.tools[tool] = v; row.toolCalls += v; }
    days.set(day, row);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}
