// Bindings injected at runtime that wrangler cannot know about.
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    /** Injected by @cloudflare/workers-oauth-provider for the default handler. */
    OAUTH_PROVIDER: OAuthHelpers;
  }
}
export {};
