"use client";

// Pricing — credits model. Editing and export are free forever (everything
// renders on-device); credits pay only for the optional AI calls. The tier
// checkout is a STUB the operator wires to a real payment provider — see
// startCheckout() below.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Gem, Sparkles, Zap } from "lucide-react";
import { PRICING_TIERS, CREDIT_COSTS, CREDIT_ACTION_LABELS, tierCreditsLabel, type PricingTier, type CreditAction } from "@/lib/credits";
import { getWallet, onWalletChange, type LedgerEntry } from "@/lib/wallet";

export default function PricingPage() {
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getWallet()
        .then((w) => {
          if (!alive) return;
          setBalance(w.balance);
          setLedger(w.ledger.slice(0, 6));
        })
        .catch(() => {});
    load();
    const off = onWalletChange(load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Operator: connect Stripe / Lemon Squeezy / Paddle here. On a successful
  // purchase, call grantCredits(tier.credits, `Purchased ${tier.name}`) from
  // your webhook/confirmation. Left as a stub so the app ships without keys.
  function startCheckout(tier: PricingTier) {
    if (tier.id === "free") {
      setNote("You're on Free — unlimited editing, plus your starter AI credits.");
    } else if (tier.byoKey) {
      setNote("Bring-your-own-key: add your provider key in .env.local and the credit meter turns off entirely.");
    } else {
      setNote(`Checkout isn't connected yet. Wire a payment provider in startCheckout() to sell ${tier.name}.`);
    }
    setTimeout(() => setNote(null), 5000);
  }

  return (
    <main className="flex flex-1 flex-col px-6 pb-12 pt-12">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => router.back()} aria-label="Back" className="flex items-center gap-1 text-sm text-neutral-400">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-1.5 rounded-full border border-card-border bg-card px-3 py-1.5 text-xs font-semibold">
          <Gem size={13} className="text-accent" />
          {balance === null ? "—" : balance.toLocaleString()} <span className="text-neutral-500">credits</span>
        </div>
      </div>

      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Editing is free<span className="text-accent">.</span>
        </h1>
        <p className="mt-2 text-sm leading-6 text-neutral-400">
          Every cut, transition, look, and export runs on your own device — no limits, no watermark, no account.
          Credits only pay for the optional <span className="text-neutral-200">AI</span> that polishes your edit.
        </p>
      </header>

      {/* On-device-is-free hero */}
      <div className="card mb-6 flex items-start gap-3 p-4">
        <Zap size={18} className="mt-0.5 shrink-0 text-accent" />
        <div>
          <p className="text-sm font-bold">Unlimited free editing</p>
          <p className="mt-0.5 text-xs leading-5 text-neutral-400">
            The deterministic engine does the heavy lifting, so even a basic AI key produces great results — the AI
            just refines what the app already got right. No key at all? You still get the full editor.
          </p>
        </div>
      </div>

      {/* Tiers */}
      <div className="flex flex-col gap-3">
        {PRICING_TIERS.map((tier) => (
          <div
            key={tier.id}
            className={`card p-4 ${tier.highlight ? "border-accent" : ""}`}
          >
            <div className="flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{tier.name}</h2>
                {tier.highlight && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    Popular
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className="text-xl font-extrabold">{tier.price}</span>
                <span className="text-xs text-neutral-500">{tier.period}</span>
              </div>
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">{tier.tagline}</p>
            <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-accent">
              <Gem size={12} /> {tierCreditsLabel(tier)}
            </div>
            <ul className="mt-3 flex flex-col gap-1.5">
              {tier.perks.map((p) => (
                <li key={p} className="flex items-start gap-2 text-xs leading-5 text-neutral-300">
                  <Check size={13} className="mt-0.5 shrink-0 text-accent" /> {p}
                </li>
              ))}
            </ul>
            <button
              onClick={() => startCheckout(tier)}
              className={`mt-4 w-full rounded-full py-2.5 text-sm font-semibold ${
                tier.highlight ? "btn-primary" : "border border-card-border text-neutral-200"
              }`}
            >
              {tier.id === "free" ? "Your current plan" : tier.byoKey ? "Use my own key" : `Get ${tier.name}`}
            </button>
          </div>
        ))}
      </div>

      {note && (
        <div className="mt-4 rounded-xl bg-accent/10 px-4 py-3 text-center text-xs leading-5 text-accent">{note}</div>
      )}

      {/* What credits buy */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-neutral-500">
          <Sparkles size={14} className="text-accent" /> What a credit buys
        </h2>
        <div className="card divide-y divide-card-border">
          {(Object.keys(CREDIT_COSTS) as CreditAction[]).map((a) => (
            <div key={a} className="flex items-center justify-between px-4 py-2.5 text-xs">
              <span className="text-neutral-300">{CREDIT_ACTION_LABELS[a]}</span>
              <span className="flex items-center gap-1 font-semibold text-neutral-400">
                {CREDIT_COSTS[a]} <Gem size={11} className="text-accent" />
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-neutral-500">
          Fair by design: you&apos;re only charged when the AI actually runs. If no provider key is configured, the
          request is free and the credit is refunded instantly.
        </p>
      </section>

      {/* Recent activity */}
      {ledger.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-500">Recent credit activity</h2>
          <div className="card divide-y divide-card-border">
            {ledger.map((e, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2 text-xs">
                <span className="truncate text-neutral-400">{e.reason}</span>
                <span className={`ml-3 shrink-0 font-mono font-semibold ${e.delta >= 0 ? "text-green-400" : "text-neutral-500"}`}>
                  {e.delta >= 0 ? "+" : ""}
                  {e.delta}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
