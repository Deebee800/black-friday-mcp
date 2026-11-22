import { describe, expect, it } from "vitest";
import { dayHash, foldUsage, SEEN_ANY, SEEN_TOOL, toolCalls, trackDelta } from "../src/usage";

const call = (name: unknown, id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } });

describe("toolCalls", () => {
  it("reads a single tools/call", () => {
    expect(toolCalls(JSON.stringify(call("search_deals")))).toEqual(["search_deals"]);
  });
  it("reads every call in a batch and ignores other methods", () => {
    const batch = [call("check_deal"), { jsonrpc: "2.0", id: 2, method: "tools/list" }, call("gift_ideas", 3), { jsonrpc: "2.0", method: "notifications/initialized" }];
    expect(toolCalls(JSON.stringify(batch))).toEqual(["check_deal", "gift_ideas"]);
  });
  it("buckets unknown tool names so storage keys stay bounded", () => {
    expect(toolCalls(JSON.stringify([call("../../evil"), call(42), call(undefined)]))).toEqual(["other", "other", "other"]);
  });
  it("returns nothing for initialize, junk, or empty bodies", () => {
    expect(toolCalls(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }))).toEqual([]);
    expect(toolCalls("not json")).toEqual([]);
    expect(toolCalls("")).toEqual([]);
    expect(toolCalls("null")).toEqual([]);
  });
  it("caps a huge batch", () => {
    expect(toolCalls(JSON.stringify(Array.from({ length: 50 }, (_, i) => call("search_deals", i))))).toHaveLength(20);
  });
});

describe("trackDelta", () => {
  it("first request of the day counts the install as connected", () => {
    expect(trackDelta(0, 0)).toEqual({ mask: SEEN_ANY, connected: 1, users: 0 });
  });
  it("first tool call counts a user once", () => {
    expect(trackDelta(0, 2)).toEqual({ mask: SEEN_ANY | SEEN_TOOL, connected: 1, users: 1 });
    expect(trackDelta(SEEN_ANY, 1)).toEqual({ mask: SEEN_ANY | SEEN_TOOL, connected: 0, users: 1 });
  });
  it("repeat requests change nothing", () => {
    expect(trackDelta(SEEN_ANY | SEEN_TOOL, 3)).toEqual({ mask: SEEN_ANY | SEEN_TOOL, connected: 0, users: 0 });
    expect(trackDelta(SEEN_ANY, 0)).toEqual({ mask: SEEN_ANY, connected: 0, users: 0 });
  });
});

describe("dayHash", () => {
  it("is stable within a day, different across days, and never contains the ID", async () => {
    const id = "install-abc123";
    const a = await dayHash(id, "2026-11-22");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await dayHash(id, "2026-11-22")).toBe(a);
    expect(await dayHash(id, "2026-11-23")).not.toBe(a);
    expect(a).not.toContain("abc123");
  });
});

describe("foldUsage", () => {
  it("groups counters by day, sums tool calls, newest first", () => {
    const rows = foldUsage([
      ["s:2026-11-21:connected", 4], ["s:2026-11-21:users", 2], ["s:2026-11-21:tool:search_deals", 5],
      ["s:2026-11-22:connected", 6], ["s:2026-11-22:users", 3], ["s:2026-11-22:tool:search_deals", 7], ["s:2026-11-22:tool:check_deal", 2],
    ]);
    expect(rows).toEqual([
      { day: "2026-11-22", connected: 6, users: 3, toolCalls: 9, tools: { search_deals: 7, check_deal: 2 } },
      { day: "2026-11-21", connected: 4, users: 2, toolCalls: 5, tools: { search_deals: 5 } },
    ]);
  });
});
