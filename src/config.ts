// Runtime config lives in CACHE_KV under key "config" and can be changed without a redeploy.
// Change it with: npx wrangler kv key put --binding CACHE_KV --remote config '{...}' (without --remote you edit local dev KV only).
// Unknown keys are ignored; missing keys fall back to defaults.
// Not here: the ~60 tool calls/min burst guard is Cloudflare's rate limiter in wrangler.jsonc (INSTALL_RL) and needs a redeploy to change.

export interface RuntimeConfig {
  /** Max Amazon calls per UTC day the gate will make. Keep below Amazon's real allowance. */
  dailyBudget: number;
  /** Max Amazon calls per second (Amazon starter: 1). */
  tps: number;
  /** Per-install cap on Amazon-costing calls (cache misses) per UTC day. */
  installDailyCap: number;
  /** Per-install cap on Amazon-costing calls (cache misses) per minute. Exact, enforced in the gate. */
  installPerMinuteMisses: number;
  /** How long an offer/price is considered fresh (seconds). Amazon recommends ≤ 3600. */
  offersTtlS: number;
  /** Hard maximum age we will ever serve from cache (seconds). Amazon cap: 86400. */
  staleMaxS: number;
  /** Beyond this age a card carries "price may have changed" (seconds). */
  staleWarnS: number;
  /** Max seconds a tool call may wait for a gate slot before degrading. */
  maxWaitS: number;
  prewarmEnabled: boolean;
  /** Fraction of dailyBudget pre-warm may use. */
  prewarmMaxShare: number;
}

export const DEFAULT_CONFIG: RuntimeConfig = {
  dailyBudget: 6000,
  tps: 1,
  installDailyCap: 150,
  installPerMinuteMisses: 10,
  offersTtlS: 3600,
  staleMaxS: 86_400,
  staleWarnS: 3 * 3600,
  maxWaitS: 4,
  prewarmEnabled: false,
  prewarmMaxShare: 0.1,
};

const NUMERIC: (keyof RuntimeConfig)[] = ["dailyBudget", "tps", "installDailyCap", "installPerMinuteMisses", "offersTtlS", "staleMaxS", "staleWarnS", "maxWaitS", "prewarmMaxShare"];

export function mergeConfig(raw: unknown): RuntimeConfig {
  const cfg: RuntimeConfig = { ...DEFAULT_CONFIG };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const k of NUMERIC) {
      const v = r[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) (cfg as any)[k] = v;
    }
    if (typeof r.prewarmEnabled === "boolean") cfg.prewarmEnabled = r.prewarmEnabled;
  }
  cfg.staleMaxS = Math.min(cfg.staleMaxS, 86_400); // Amazon hard cap
  cfg.offersTtlS = Math.min(cfg.offersTtlS, cfg.staleMaxS);
  return cfg;
}

export async function loadConfig(kv: KVNamespace): Promise<RuntimeConfig> {
  try {
    return mergeConfig(await kv.get("config", "json"));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
