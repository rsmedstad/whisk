// Overwrite the stored Discover config in KV with the current default
// (NYT + RSS blog sources; AllRecipes/Serious Eats disabled).
// A stored discover_config overrides the code defaults in both config.ts and
// feed.ts, so this is how you reset/seed it.
//
// Usage:
//   npx wrangler login          # refresh OAuth if expired
//   bun scripts/set-discover-config.ts

import { readFileSync } from "fs";
import { getKVClient } from "./lib/cloudflare";
import { DEFAULT_DISCOVER_CONFIG } from "../functions/lib/discover-config";

if (!process.env.CF_ACCOUNT_ID) {
  try {
    process.env.CF_ACCOUNT_ID = readFileSync(".dev.vars", "utf8").match(/^CF_ACCOUNT_ID=(.*)$/m)?.[1]?.trim();
  } catch { /* ignore */ }
}

const { baseUrl, headers } = await getKVClient();

// Show what's currently stored (if anything) before overwriting
const before = await fetch(`${baseUrl}/values/discover_config`, { headers });
if (before.ok) {
  const cur = (await before.json()) as { sources?: { id: string; enabled: boolean }[] };
  console.log("Current sources:", cur.sources?.map((s) => `${s.id}${s.enabled ? "" : "(off)"}`).join(", ") ?? "(none)");
} else {
  console.log(`No existing discover_config (status ${before.status}).`);
}

const res = await fetch(`${baseUrl}/values/discover_config`, {
  method: "PUT",
  headers,
  body: JSON.stringify(DEFAULT_DISCOVER_CONFIG),
});
const data = (await res.json()) as { success?: boolean; errors?: unknown };
if (res.ok && data.success) {
  console.log("\n✅ discover_config updated to:");
  for (const s of DEFAULT_DISCOVER_CONFIG.sources) {
    console.log(`   ${s.enabled ? "✓" : "·"} ${s.label}${s.feedUrl ? "  (RSS)" : ""}`);
  }
} else {
  console.error(`\n❌ Write failed (status ${res.status}):`, JSON.stringify(data));
  process.exit(1);
}
