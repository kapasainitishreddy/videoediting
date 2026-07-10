import { NextRequest } from "next/server";
import Stripe from "stripe";
import { PRICING_TIERS, tierCheckout } from "@/lib/credits";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 30;

const LIMIT = 20;
const WINDOW_MS = 10 * 60_000;

// Payment checkout via Stripe — key-gated exactly like the AI features.
// Add STRIPE_SECRET_KEY to .env.local and this route creates a real Stripe
// Checkout Session; without it the route reports unavailable and the app
// falls back to the "not connected yet" message, so it ships without keys.
//
// ACCOUNT-LESS BY DESIGN: this app has no login — the credit wallet lives in
// the browser (IndexedDB). So checkout is a ONE-TIME credit purchase
// (mode: "payment"), and the credits are granted to the local wallet when
// the browser returns from Stripe and /api/checkout/verify confirms the
// session is paid. True recurring subscriptions (auto-renew, cross-device)
// would require adding user accounts + a database + Stripe webhooks that
// mutate server-side balances — deliberately out of scope for the
// local-first core. The tiers are sold here as one-time credit packs at the
// same price/credit amounts.
//
// POST { tierId } → { url }  (redirect the browser there)
export async function POST(req: NextRequest) {
  const rl = checkRateLimit(`${clientIp(req)}:checkout`, LIMIT, WINDOW_MS);
  if (!rl.ok) return rateLimitResponse(rl);

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return Response.json(
      { available: false, error: "Checkout isn't connected. Add STRIPE_SECRET_KEY to .env.local to sell credit packs." },
      { status: 200 }
    );
  }

  let body: { tierId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tier = PRICING_TIERS.find((t) => t.id === body.tierId);
  if (!tier) return Response.json({ error: "Unknown tier" }, { status: 400 });
  const checkout = tierCheckout(tier);
  if (!checkout) return Response.json({ error: "This tier isn't purchasable." }, { status: 400 });

  const origin = req.headers.get("origin") || req.nextUrl.origin;
  try {
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: checkout.amountCents,
            product_data: {
              name: `ViralEdit ${tier.name} — ${checkout.credits.toLocaleString()} AI credits`,
              description: tier.tagline,
            },
          },
        },
      ],
      // The credit grant travels in metadata; /api/checkout/verify reads it
      // back after payment so the client can credit the local wallet.
      metadata: { tierId: tier.id, credits: String(checkout.credits) },
      success_url: `${origin}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?checkout=cancel`,
    });
    return Response.json({ available: true, url: session.url });
  } catch (err) {
    return Response.json({ available: true, error: `Stripe error: ${String(err).slice(0, 200)}` }, { status: 502 });
  }
}
