// Shared helpers to prevent SSRF when fetching URLs supplied (directly or
// indirectly) by end users. Covers the main page URL and any image URLs
// embedded in JSON-LD / HTML that we later fetch to copy into R2.

/** Parse a dotted-quad IPv4 literal into four numeric octets, or null if it isn't one. */
export function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

/** True if the IPv4 octets fall in a loopback, private, link-local, or metadata range. */
export function isPrivateIPv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/** True for IPv6 loopback, unique-local (fc00::/7), or link-local (fe80::/10). */
export function isPrivateIPv6(host: string): boolean {
  // URL parser wraps IPv6 hosts in []; strip if present.
  let h = host;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  h = h.toLowerCase();
  if (h === "::1" || h === "::") return true;
  // fc00::/7 → first byte 0xfc or 0xfd → prefixes "fc" / "fd"
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true;
  // fe80::/10 → first 10 bits are 1111111010 → prefixes "fe8", "fe9", "fea", "feb"
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;
  return false;
}

/** True for any host that should be rejected to prevent SSRF. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  const v4 = parseIPv4(h);
  if (v4) return isPrivateIPv4(v4);
  if (h.includes(":") || (h.startsWith("[") && h.endsWith("]"))) return isPrivateIPv6(h);
  return false;
}

/** True if the URL is safe to fetch (http/https + non-internal host). */
export function isSafeFetchUrl(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return !isBlockedHost(u.hostname);
  } catch {
    return false;
  }
}
