/**
 * Shared Cloudflare config reader for scripts.
 * Reads CF_ACCOUNT_ID and KV namespace ID from wrangler.toml,
 * and the OAuth token from the wrangler config file.
 */

import { resolve } from "path";

/** Read wrangler.toml and extract account/namespace IDs */
export async function loadWranglerConfig(configFile = "wrangler.toml") {
  const wranglerPath = resolve(process.cwd(), configFile);
  const toml = await Bun.file(wranglerPath).text();

  // Extract KV namespace ID
  const kvMatch = toml.match(/\[\[kv_namespaces\]\][^[]*?id\s*=\s*"([^"]+)"/s);
  const kvNamespaceId = kvMatch?.[1];
  if (!kvNamespaceId) {
    console.error(`No KV namespace ID found in ${configFile}`);
    process.exit(1);
  }

  // Extract R2 bucket name
  const r2Match = toml.match(/\[\[r2_buckets\]\][^[]*?bucket_name\s*=\s*"([^"]+)"/s);
  const r2BucketName = r2Match?.[1] ?? "whisk-photos";

  return { kvNamespaceId, r2BucketName };
}

/** Read the Cloudflare account ID from environment or wrangler config */
export function getAccountId(): string {
  const fromEnv = process.env.CF_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  if (fromEnv) return fromEnv;

  console.error("Set CF_ACCOUNT_ID environment variable (your Cloudflare account ID)");
  process.exit(1);
}

/** Read the wrangler OAuth token from the local config file */
export async function getOAuthToken(): Promise<string> {
  // CI (GitHub Actions) passes an API token instead of a wrangler login
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;

  // Try standard wrangler config locations
  const paths = [
    `${process.env.APPDATA}/xdg.config/.wrangler/config/default.toml`,
    `${process.env.HOME}/.wrangler/config/default.toml`,
    `${process.env.XDG_CONFIG_HOME ?? `${process.env.HOME}/.config`}/.wrangler/config/default.toml`,
  ].filter(Boolean);

  // Wrangler versions save the login in different places, so a stale token can
  // sit beside a fresh one. Use the one that expires last.
  let best: { token: string; expires: number } | undefined;
  for (const configPath of paths) {
    try {
      const config = await Bun.file(configPath).text();
      const tokenMatch = config.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (!tokenMatch?.[1]) continue;
      const expiresMatch = config.match(/expiration_time\s*=\s*"([^"]+)"/);
      const expires = expiresMatch?.[1] ? Date.parse(expiresMatch[1]) || 0 : 0;
      if (!best || expires > best.expires) best = { token: tokenMatch[1], expires };
    } catch {
      // Try next path
    }
  }
  if (best) return best.token;

  console.error("No wrangler OAuth token found. Run 'npx wrangler whoami' to authenticate.");
  process.exit(1);
}

/** Get standard headers and base URL for KV API calls */
export async function getKVClient(configFile?: string) {
  const accountId = getAccountId();
  const { kvNamespaceId } = await loadWranglerConfig(configFile);
  const token = await getOAuthToken();

  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvNamespaceId}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  return { baseUrl, headers, accountId, kvNamespaceId };
}
