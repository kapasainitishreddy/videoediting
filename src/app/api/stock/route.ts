import { NextRequest } from "next/server";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 30;

// Free CC-licensed stock search — NO API key required. Openverse
// (openverse.org, the WordPress/Creative-Commons search engine) indexes
// CC0/CC-BY audio and images with machine-readable licenses. The route
// proxies the search (browser CORS) and maps results to a compact shape;
// the client records each pick in the license tracker so attribution is
// automatic. Video stock needs keyed providers (Pexels/Pixabay) — that is
// deliberately out of scope for the keyless tier.
const LIMIT = 30;
const WINDOW_MS = 5 * 60_000;

interface StockResult {
  id: string;
  title: string;
  creator: string;
  license: string;
  licenseUrl: string;
  url: string; // direct media URL
  thumb: string | null;
  duration: number | null; // seconds, audio only
  source: string;
}

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(`${clientIp(req)}:stock`, LIMIT, WINDOW_MS);
  if (!rl.ok) return rateLimitResponse(rl);

  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80).trim();
  const kind = req.nextUrl.searchParams.get("kind") === "image" ? "images" : "audio";
  if (q.length < 2) return Response.json({ error: "Query too short" }, { status: 400 });

  try {
    const url = `https://api.openverse.org/v1/${kind}/?q=${encodeURIComponent(q)}&page_size=12&license_type=all-cc`;
    const res = await fetch(url, { headers: { "User-Agent": "ViralEdit/1.0 (stock search)" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return Response.json({ error: `Stock search unavailable (${res.status})` }, { status: 502 });
    }
    const data = (await res.json()) as {
      results?: {
        id: string;
        title?: string;
        creator?: string;
        license?: string;
        license_version?: string;
        license_url?: string;
        url?: string;
        thumbnail?: string;
        duration?: number; // ms for audio
        source?: string;
      }[];
    };
    const results: StockResult[] = (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        id: r.id,
        title: (r.title ?? "Untitled").slice(0, 80),
        creator: (r.creator ?? "Unknown").slice(0, 60),
        license: `CC ${(r.license ?? "").toUpperCase()}${r.license_version ? ` ${r.license_version}` : ""}`.trim(),
        licenseUrl: r.license_url ?? "",
        url: r.url!,
        thumb: r.thumbnail ?? null,
        duration: typeof r.duration === "number" ? Math.round(r.duration / 100) / 10 : null,
        source: r.source ?? "openverse",
      }));
    return Response.json({ results, kind });
  } catch (err) {
    return Response.json({ error: `Stock search failed: ${String(err).slice(0, 120)}` }, { status: 502 });
  }
}
