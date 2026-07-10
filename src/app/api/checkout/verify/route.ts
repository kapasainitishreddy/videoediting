import { NextRequest } from "next/server";
import Stripe from "stripe";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 30;

const LIMIT = 40;
const WINDOW_MS = 10 * 60_000;

// Confirm a returned Checkout Session is paid, and hand back the credit grant
// so the client can add it to the local wallet. The client guards against
// double-crediting by remembering the session_id it already redeemed
// (localStorage) — a pragmatic account-less safeguard. A production
// deployment with real revenue should additionally track consumed sessions
// server-side (a tiny KV/DB) so a shared URL can't be replayed; noted in
// /api/checkout's header.
//
// GET ?session_id=cs_... → { paid, credits, tier }
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(`${clientIp(req)}:checkout-verify`, LIMIT, WINDOW_MS);
  if (!rl.ok) return rateLimitResponse(rl);

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return Response.json({ available: false, paid: false }, { status: 200 });

  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return Response.json({ error: "Missing or malformed session_id" }, { status: 400 });
  }

  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === "paid";
    const credits = paid ? parseInt(session.metadata?.credits ?? "0", 10) : 0;
    return Response.json({
      available: true,
      paid,
      credits: Number.isFinite(credits) ? credits : 0,
      tier: session.metadata?.tierId ?? null,
    });
  } catch (err) {
    return Response.json({ available: true, paid: false, error: String(err).slice(0, 160) }, { status: 502 });
  }
}
