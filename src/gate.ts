// The Gate: a single Durable Object that is the only thing talking to Amazon.
// It paces calls (≤ tps), enforces the daily budget and per-install daily caps, coalesces identical
// in-flight lookups, holds the LWA token, backs off on 429s, and writes results to KV.
import { DurableObject } from "cloudflare:workers";
import { AmazonError, fetchToken, getItems, searchItems, type Token } from "./amazon/client";
import { toCard } from "./amazon/map";
import type { ProductCard, SearchParams } from "./amazon/types";
import { putCached } from "./cache";
import { loadConfig, type RuntimeConfig } from "./config";
import { DAY_MS, prewarmPerTick, selectPrewarmCandidates, type DemandRecord } from "./prewarm";
import { dayHash, foldUsage, trackDelta, USAGE_KEEP_DAYS, type DayUsage } from "./usage";

export type GateRequest = { installId: string; key: string; source: "user" | "prewarm" } & (
  | { op: "search"; params: SearchParams }
  | { op: "items"; asins: string[] }
);

export type GateFailReason = "install_cap" | "rate_limited" | "budget" | "amazon_throttled" | "amazon_error" | "timeout" | "auth";

export type GateResult =
  | { ok: true; cards: ProductCard[]; fetchedAt: string; totalResults?: number; coalesced: boolean }
  | { ok: false; reason: GateFailReason; retryAfterS?: number; message: string };

interface Stats {
  day: string;
  dayCount: number;
  prewarmCount: number;
  throttles: number;
  tokenExpiresAt: number | null;
  amazonBackoffUntil: number;
  tokenBackoffUntil: number;
  demandKeys: number;
  lastUserCallAt: number | null;
  /** Newest first, up to 14 days. connected = installs that sent any request; users = installs that called a tool. */
  usage: DayUsage[];
  cfg: RuntimeConfig;
}

const TOKEN_REFRESH_EARLY_MS = 6 * 60_000;
const CONFIG_TTL_MS = 60_000;
const RECENT_MAX = 2000;
/** Whole-call ceiling (queue wait + token + Amazon) so a slow Amazon cannot push a tool call past the client's timeout. */
const TOTAL_BUDGET_MS = 9_000;
const MIN_FETCH_MS = 1_500;

function utcDay(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class Gate extends DurableObject<Env> {
  private inflight = new Map<string, Promise<GateResult>>();
  /** Recent results by cache key. Covers KV replication lag so a repeat lookup never costs a call or counts against a cap. */
  private recent = new Map<string, { fetchedAt: string; cards: ProductCard[]; totalResults?: number }>();
  /** Amazon-costing calls per install in the current minute (in-memory; exact within this single DO). */
  private minuteMisses = new Map<string, { minute: number; count: number }>();
  private lastUserCallAt = 0;
  private lastUserCallPersistedAt = 0;
  private nextSlotAt = 0;
  private cfg: RuntimeConfig | null = null;
  private cfgLoadedAt = 0;
  private token: Token | null = null;
  private tokenBackoffUntil = 0;
  private amazonBackoffUntil = 0;

  private async config(): Promise<RuntimeConfig> {
    if (!this.cfg || Date.now() - this.cfgLoadedAt > CONFIG_TTL_MS) {
      this.cfg = await loadConfig(this.env.CACHE_KV);
      this.cfgLoadedAt = Date.now();
    }
    return this.cfg;
  }

  private async counter(key: string): Promise<number> {
    return (await this.ctx.storage.get<number>(key)) ?? 0;
  }

  private async bump(key: string, ttlDays = 2): Promise<number> {
    const n = (await this.counter(key)) + 1;
    await this.ctx.storage.put(key, n);
    // Cheap housekeeping: drop yesterday's keys occasionally.
    if (n % 100 === 0) this.ctx.waitUntil(this.sweep(ttlDays));
    return n;
  }

  private async unbump(key: string) {
    const n = await this.counter(key);
    if (n > 0) await this.ctx.storage.put(key, n - 1);
  }

  private async sweep(ttlDays: number) {
    const cutoff = utcDay(Date.now() - ttlDays * 86_400_000);
    const all = await this.ctx.storage.list<number>({ prefix: "c:" });
    const dead = [...all.keys()].filter(k => k.slice(2, 12) < cutoff);
    if (dead.length) await this.ctx.storage.delete(dead);
    await this.pruneDemand(Date.now());
  }

  /** Demand records (query text, no install IDs) live at most 24 h past their last use. Runs whether or not pre-warm is on. */
  private async pruneDemand(now: number): Promise<number> {
    const all = await this.ctx.storage.list<DemandRecord>({ prefix: "d:" });
    const dead = [...all.entries()].filter(([, r]) => now - r.lastUserAt > DAY_MS).slice(0, 500).map(([k]) => k);
    if (dead.length) await this.ctx.storage.delete(dead);
    return dead.length;
  }

  private async ensureToken(timeoutMs: number): Promise<Token> {
    const now = Date.now();
    if (!this.token) this.token = (await this.ctx.storage.get<Token>("token")) ?? null;
    if (this.token && this.token.expiresAt - now > TOKEN_REFRESH_EARLY_MS) return this.token;
    if (this.tokenBackoffUntil > now) {
      if (this.token && this.token.expiresAt > now) return this.token; // still valid; use it while backed off
      throw new AmazonError("LWA token endpoint backed off", 429, "token_backoff", Math.ceil((this.tokenBackoffUntil - now) / 1000));
    }
    try {
      this.token = await fetchToken(this.env.AMAZON_CLIENT_ID, this.env.AMAZON_CLIENT_SECRET, timeoutMs);
      await this.ctx.storage.put("token", this.token);
      return this.token;
    } catch (e) {
      if (e instanceof AmazonError && e.isThrottle) this.tokenBackoffUntil = now + (e.retryAfterSeconds ?? 300) * 1000;
      if (this.token && this.token.expiresAt > now) return this.token;
      throw e;
    }
  }

  async lookup(req: GateRequest): Promise<GateResult> {
    const existing = this.inflight.get(req.key);
    if (existing) {
      const r = await existing;
      return r.ok ? { ...r, coalesced: true } : r;
    }
    const p = this.run(req).finally(() => this.inflight.delete(req.key));
    this.inflight.set(req.key, p);
    return p;
  }

  private remember(key: string, value: { fetchedAt: string; cards: ProductCard[]; totalResults?: number }) {
    this.recent.delete(key);
    this.recent.set(key, value);
    if (this.recent.size > RECENT_MAX) this.recent.delete(this.recent.keys().next().value as string);
  }

  private async run(req: GateRequest): Promise<GateResult> {
    const cfg = await this.config();
    const started = Date.now();
    const now = started;
    const day = utcDay(now);
    const remaining = () => Math.max(MIN_FETCH_MS, TOTAL_BUDGET_MS - (Date.now() - started));

    const r = this.recent.get(req.key);
    if (r && now - Date.parse(r.fetchedAt) < cfg.offersTtlS * 1000) {
      return { ok: true, cards: r.cards, fetchedAt: r.fetchedAt, totalResults: r.totalResults, coalesced: true };
    }

    if (this.amazonBackoffUntil > now) {
      return { ok: false, reason: "amazon_throttled", retryAfterS: Math.ceil((this.amazonBackoffUntil - now) / 1000), message: "Amazon is throttling us" };
    }
    const dayKey = `c:${day}:day`;
    const dayCount = await this.counter(dayKey);
    if (req.source === "prewarm") {
      if (!cfg.prewarmEnabled || (await this.counter(`c:${day}:prewarm`)) >= cfg.dailyBudget * cfg.prewarmMaxShare) {
        return { ok: false, reason: "budget", message: "pre-warm budget exhausted" };
      }
    }
    if (dayCount >= cfg.dailyBudget) return { ok: false, reason: "budget", message: "daily Amazon budget exhausted" };
    const callerKey = req.source === "prewarm" ? `c:${day}:prewarm` : `c:${day}:i:${req.installId}`;
    if (req.source === "user") {
      if ((await this.counter(callerKey)) >= cfg.installDailyCap) return { ok: false, reason: "install_cap", message: "install daily cap" };
      const minute = Math.floor(now / 60_000);
      const mm = this.minuteMisses.get(req.installId);
      const count = mm && mm.minute === minute ? mm.count : 0;
      if (count >= cfg.installPerMinuteMisses) return { ok: false, reason: "rate_limited", retryAfterS: 60 - Math.floor((now % 60_000) / 1000), message: "install per-minute cap" };
      this.minuteMisses.set(req.installId, { minute, count: count + 1 });
      if (this.minuteMisses.size > 5000) for (const [k, v] of this.minuteMisses) if (v.minute !== minute) this.minuteMisses.delete(k);
    }

    // Pace: one slot every 1000/tps ms. Bounded wait.
    const interval = 1000 / Math.max(cfg.tps, 0.05);
    const slot = Math.max(Date.now(), this.nextSlotAt);
    const wait = slot - Date.now();
    if (wait > cfg.maxWaitS * 1000) return { ok: false, reason: "timeout", retryAfterS: Math.ceil(wait / 1000), message: "queue too long" };
    this.nextSlotAt = slot + interval;

    // Reserve the budget and caller counters now, before any await that lets other requests in.
    // Storage awaits do not release the DO input gate, so the checks above and this reservation are one atomic step.
    await this.bump(dayKey);
    await this.bump(callerKey);
    const refund = async () => { await this.unbump(dayKey); await this.unbump(callerKey); };

    if (wait > 0) await sleep(wait);

    let token: Token;
    try {
      token = await this.ensureToken(remaining());
    } catch (e) {
      await refund(); // nothing was sent to the catalog API
      const err = e as AmazonError;
      return { ok: false, reason: err?.isThrottle ? "amazon_throttled" : "auth", retryAfterS: err?.retryAfterSeconds, message: err?.message ?? "token error" };
    }

    const fetchedAt = new Date().toISOString();
    try {
      const { cards, totalResults } = await this.callAmazon(req, token.accessToken, fetchedAt, remaining());
      this.remember(req.key, { fetchedAt, cards, totalResults });
      await putCached(this.env.CACHE_KV, req.key, { cards, totalResults }, cfg, fetchedAt);
      await this.recordDemand(req, Date.now());
      return { ok: true, cards, fetchedAt, totalResults, coalesced: false };
    } catch (e) {
      if (e instanceof AmazonError) {
        if (e.status === 401) { this.token = null; await this.ctx.storage.delete("token"); }
        if (e.isThrottle) {
          this.amazonBackoffUntil = Date.now() + (e.retryAfterSeconds ?? 60) * 1000;
          await this.bump(`c:${day}:throttles`);
          return { ok: false, reason: "amazon_throttled", retryAfterS: e.retryAfterSeconds ?? 60, message: e.message };
        }
        if (e.isAuth) return { ok: false, reason: "auth", message: e.message };
        return { ok: false, reason: "amazon_error", message: e.message };
      }
      if ((e as Error)?.name === "TimeoutError") return { ok: false, reason: "timeout", message: "Amazon took too long to answer" };
      return { ok: false, reason: "amazon_error", message: (e as Error)?.message ?? "unknown error" };
    }
  }

  private async callAmazon(req: GateRequest, token: string, fetchedAt: string, timeoutMs: number): Promise<{ cards: ProductCard[]; totalResults?: number }> {
    const tag = this.env.AMAZON_PARTNER_TAG;
    if (req.op === "items") {
      const res = await getItems(req.asins, tag, token, timeoutMs);
      const cards = (res.itemsResult?.items ?? []).map(i => toCard(i, fetchedAt)).filter((c): c is ProductCard => !!c);
      return { cards };
    }
    const res = await searchItems(req.params, tag, token, timeoutMs);
    const cards = (res.searchResult?.items ?? []).map(i => toCard(i, fetchedAt)).filter((c): c is ProductCard => !!c);
    return { cards, totalResults: res.searchResult?.totalResultCount };
  }

  private async recordDemand(req: GateRequest, now: number) {
    const dKey = `d:${req.key}`;
    const prev = await this.ctx.storage.get<DemandRecord>(dKey);
    const stale = !prev || now - prev.lastUserAt > DAY_MS;
    const rec: DemandRecord = {
      key: req.key,
      op: req.op,
      payload: req.op === "search" ? req.params : req.asins,
      count: req.source === "user" ? (stale ? 1 : prev!.count + 1) : (prev?.count ?? 0),
      lastUserAt: req.source === "user" ? now : (prev?.lastUserAt ?? 0),
      lastFetchedAt: now,
    };
    if (req.source !== "user" && !prev) return; // never create demand from pre-warm itself
    await this.ctx.storage.put(dKey, rec);
    if (req.source === "user") {
      this.lastUserCallAt = now;
      if (now - this.lastUserCallPersistedAt > 60_000) {
        this.lastUserCallPersistedAt = now;
        await this.ctx.storage.put("lastUserCallAt", now);
      }
    }
  }

  /** Cron entry: refresh a few popular, about-to-expire queries. Demand-driven, jittered, budget-capped, self-disabling. */
  async prewarm(): Promise<{ ran: number; skipped: string; pruned: number }> {
    const cfg = await this.config();
    const now = Date.now();
    const pruned = await this.pruneDemand(now); // every 10 min, regardless of prewarm state
    await this.sweepUsage(utcDay(now));
    if (!cfg.prewarmEnabled) return { ran: 0, skipped: "disabled", pruned };
    if (!this.lastUserCallAt) this.lastUserCallAt = (await this.ctx.storage.get<number>("lastUserCallAt")) ?? 0;
    if (now - this.lastUserCallAt > 3_600_000) return { ran: 0, skipped: "no recent traffic", pruned };
    if (this.amazonBackoffUntil > now) return { ran: 0, skipped: "backed off", pruned };
    const day = utcDay(now);
    const share = Math.floor(cfg.dailyBudget * cfg.prewarmMaxShare);
    const used = await this.counter(`c:${day}:prewarm`);
    if (used >= share) return { ran: 0, skipped: "share exhausted", pruned };
    if ((await this.counter(`c:${day}:day`)) >= cfg.dailyBudget) return { ran: 0, skipped: "budget exhausted", pruned };

    const all = await this.ctx.storage.list<DemandRecord>({ prefix: "d:" });
    const records = [...all.values()];
    const perTick = Math.min(prewarmPerTick(cfg), share - used);
    const picks = selectPrewarmCandidates(records, cfg, now, perTick);
    if (!picks.length) return { ran: 0, skipped: "nothing due", pruned };
    await sleep(Math.floor(Math.random() * 20_000)); // jitter: never fire exactly on the cron tick
    let ran = 0;
    for (const r of picks) {
      const res = await this.lookup({
        installId: "prewarm",
        key: r.key,
        source: "prewarm",
        ...(r.op === "search" ? { op: "search" as const, params: r.payload as SearchParams } : { op: "items" as const, asins: r.payload as string[] }),
      });
      if (res.ok) ran++;
      else if (res.reason === "budget" || res.reason === "amazon_throttled") break;
    }
    return { ran, skipped: "", pruned };
  }

  async stats(): Promise<Stats> {
    const cfg = await this.config();
    const day = utcDay();
    if (!this.token) this.token = (await this.ctx.storage.get<Token>("token")) ?? null;
    return {
      day,
      dayCount: await this.counter(`c:${day}:day`),
      prewarmCount: await this.counter(`c:${day}:prewarm`),
      throttles: await this.counter(`c:${day}:throttles`),
      tokenExpiresAt: this.token?.expiresAt ?? null,
      amazonBackoffUntil: this.amazonBackoffUntil,
      tokenBackoffUntil: this.tokenBackoffUntil,
      demandKeys: (await this.ctx.storage.list({ prefix: "d:" })).size,
      lastUserCallAt: this.lastUserCallAt || ((await this.ctx.storage.get<number>("lastUserCallAt")) ?? null),
      usage: await this.usage(),
      cfg,
    };
  }

  /** Counts one authenticated /mcp request. Totals only; see src/usage.ts. Called off the response path. */
  async track(installId: string, tools: string[]): Promise<void> {
    const day = utcDay();
    const seenKey = `a:${day}:${await dayHash(installId, day)}`; // the only non-storage await, before the read-modify-write
    const seen = (await this.ctx.storage.get<number>(seenKey)) ?? 0;
    const d = trackDelta(seen, tools.length);
    const puts: Record<string, number> = {};
    const add = async (key: string) => { puts[key] = (puts[key] ?? (await this.counter(key))) + 1; };
    if (d.mask !== seen) puts[seenKey] = d.mask;
    if (d.connected) await add(`s:${day}:connected`);
    if (d.users) await add(`s:${day}:users`);
    for (const t of tools) await add(`s:${day}:tool:${t}`);
    if (Object.keys(puts).length) await this.ctx.storage.put(puts);
  }

  async usage(): Promise<DayUsage[]> {
    return foldUsage((await this.ctx.storage.list<number>({ prefix: "s:" })).entries()).slice(0, 14);
  }

  /** Seen-hashes are needed only for the current UTC day; daily totals are kept USAGE_KEEP_DAYS.
   *  Lists only deletable keys (`end` is exclusive, so today's a: keys are never read), in pages, at most 20k per tick; leftovers go next tick. */
  private async sweepUsage(today: string) {
    const cutoff = utcDay(Date.parse(today) - USAGE_KEEP_DAYS * DAY_MS);
    for (const [start, end] of [["a:", `a:${today}`], ["s:", `s:${cutoff}`]] as const) {
      for (let page = 0; page < 20; page++) {
        const keys = [...(await this.ctx.storage.list({ start, end, limit: 1000 })).keys()];
        for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
        if (keys.length < 1000) break;
      }
    }
  }
}
