// Request protection layers applied in src/server.ts before the app runs.
// In-memory and per server isolate: a cheap first line of defence on top of the
// hosting edge's own flood protection, not a global counter.

export type Verdict =
  | { action: "allow" }
  | { action: "block"; status: number; reason: string; retryAfter?: number };

/** Paths only scanners and exploit bots request on this site. */
const PROBE_PATTERNS = [
  /\.(php|asp|aspx|jsp|cgi|env|git|sql|bak|ini|htaccess)(\/|$|\?)/i,
  /^\/(wp-|wordpress|phpmyadmin|xmlrpc|cgi-bin|\.well-known\/security\.txt\.bak)/i,
  /\/\.(env|git|aws|ssh)/i,
  /(\.\.\/|%2e%2e%2f|%00)/i,
];

const BAD_AGENTS = /(sqlmap|nikto|nmap|masscan|zgrab|acunetix|nessus|dirbuster|gobuster|wpscan|python-requests\/[01]\.|curl\/[0-6]\.)/i;
const GOOD_BOTS = /(googlebot|bingbot|duckduckbot|applebot|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|yandex)/i;

export const LIMITS = {
  /** Page and asset reads per visitor per minute — generous for real readers. */
  read: 300,
  /** Writes / server calls per visitor per minute. */
  write: 60,
  /** Sign-in and sign-up attempts per visitor per 10 minutes. */
  auth: 20,
  /** Largest request body accepted, in bytes. */
  maxBody: 1_000_000,
  /** Longest URL accepted. */
  maxUrl: 2048,
};

type Bucket = { count: number; resetAt: number; strikes: number; bannedUntil: number };
const buckets = new Map<string, Bucket>();

function hit(key: string, limit: number, windowMs: number, now: number): Bucket & { over: boolean } {
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs, strikes: b?.strikes ?? 0, bannedUntil: b?.bannedUntil ?? 0 };
    buckets.set(key, b);
  }
  b.count++;
  if (buckets.size > 50_000) {
    for (const [k, v] of buckets) if (now >= v.resetAt && now >= v.bannedUntil) buckets.delete(k);
  }
  return Object.assign(b, { over: b.count > limit });
}

export function resetProtection() {
  buckets.clear();
}

export function clientKey(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function inspectRequest(req: { method: string; url: string; headers: Headers }, now = Date.now()): Verdict {
  const url = new URL(req.url);
  const ua = req.headers.get("user-agent") ?? "";
  const ip = clientKey(req.headers);

  if (req.url.length > LIMITS.maxUrl) return { action: "block", status: 414, reason: "url too long" };
  if (PROBE_PATTERNS.some((p) => p.test(url.pathname + url.search)))
    return { action: "block", status: 404, reason: "probe" };
  if (BAD_AGENTS.test(ua)) return { action: "block", status: 403, reason: "scanner" };

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > LIMITS.maxBody) return { action: "block", status: 413, reason: "body too large" };

  const ban = buckets.get(`ban:${ip}`);
  if (ban && now < ban.bannedUntil) {
    return { action: "block", status: 429, reason: "temporarily blocked", retryAfter: Math.ceil((ban.bannedUntil - now) / 1000) };
  }

  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const isAuth = isWrite && /signin|signup|login|auth/i.test(url.pathname + url.search);
  // Requests with no browser user agent at all are anomalous: half the allowance.
  const factor = ua === "" ? 0.5 : GOOD_BOTS.test(ua) ? 2 : 1;

  const checks: Array<[string, number, number]> = [[`r:${ip}`, LIMITS.read * factor, 60_000]];
  if (isWrite) checks.push([`w:${ip}`, LIMITS.write * factor, 60_000]);
  if (isAuth) checks.push([`a:${ip}`, LIMITS.auth, 600_000]);

  for (const [key, limit, windowMs] of checks) {
    const b = hit(key, limit, windowMs, now);
    if (b.over) {
      // Repeated overruns are an anomaly: escalate to a growing temporary block.
      const strikeBucket = buckets.get(`ban:${ip}`) ?? { count: 0, resetAt: Infinity, strikes: 0, bannedUntil: 0 };
      if (b.count === Math.floor(limit) + 1) strikeBucket.strikes++;
      if (strikeBucket.strikes >= 3) strikeBucket.bannedUntil = now + Math.min(60, 5 * strikeBucket.strikes) * 60_000;
      buckets.set(`ban:${ip}`, strikeBucket);
      return { action: "block", status: 429, reason: "rate limited", retryAfter: Math.ceil((b.resetAt - now) / 1000) };
    }
  }
  return { action: "allow" };
}

const PRIVATE_PATHS = /^\/(admin|profile|auth|_serverFn|api)/;

export function cacheControlFor(pathname: string, contentType: string): string | null {
  if (/^\/assets\//.test(pathname)) return "public, max-age=31536000, immutable";
  if (/\.(png|jpe?g|webp|avif|svg|ico|woff2?)$/i.test(pathname)) return "public, max-age=86400, stale-while-revalidate=604800";
  if (PRIVATE_PATHS.test(pathname)) return "private, no-store";
  if (pathname === "/sitemap.xml" || pathname === "/robots.txt") return "public, max-age=3600";
  if (contentType.includes("text/html")) return "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
  return null;
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};
