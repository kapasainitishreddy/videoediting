import { NextRequest } from "next/server";

// In-memory per-IP sliding-window rate limiter for the API routes that
// shell out to yt-dlp or call a paid AI provider — both are real abuse/cost
// vectors if left open.
//
// Honest limitation: this state lives in the Node process's memory. It
// resets on redeploy and does NOT share state across multiple server
// instances (a multi-replica deployment behind a load balancer will let
// each replica count independently). That's fine for a single-instance
// deployment (a VPS, one Docker container, Railway/Render/Fly single
// service) — the common case for this app given yt-dlp's hosting
// requirements (see README). If you scale to multiple instances, replace
// the Map below with Redis/Upstash and keep the same checkRateLimit(key)
// contract.
const buckets = new Map<string, number[]>();

// Periodic cleanup so the Map doesn't grow forever with stale IPs.
const CLEANUP_INTERVAL_MS = 5 * 60_000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, hits] of buckets) {
    const kept = hits.filter((t) => now - t < windowMs);
    if (kept.length === 0) buckets.delete(key);
    else buckets.set(key, kept);
  }
}

export function clientIp(req: NextRequest): string {
  // Trust the platform-set forwarded header (Vercel/most PaaS set this);
  // falls back to a constant bucket if truly unavailable (e.g. local dev
  // behind no proxy) rather than throwing.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * @param key       identifies the caller+route, e.g. `${ip}:download`
 * @param limit     max requests allowed within windowMs
 * @param windowMs  sliding window size
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  cleanup(windowMs);
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    const retryAfterMs = windowMs - (now - hits[0]);
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

export function rateLimitResponse(result: RateLimitResult) {
  return Response.json(
    { error: `Too many requests — try again in ${result.retryAfterSeconds}s.` },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}
