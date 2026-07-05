// Credits — the monetization core. Pure and Node-testable (no "use client",
// no storage, no DOM): just the cost table, the pricing tiers, and the spend
// math. The IndexedDB-backed wallet lives in wallet.ts and imports this.
//
// The model, in one sentence: EDITING AND EXPORT ARE ALWAYS FREE (everything
// renders on the user's own device with FFmpeg WASM). Credits only pay for the
// optional AI calls that cost the operator real API money — refining an edit,
// transcribing captions, generating B-roll, reading a reel's niche from
// frames. A user with zero credits still has the full deterministic editor;
// they just don't get the AI polish on top. That's the whole pitch: a real,
// unlimited editor for free, with AI as a paid accelerant.

export type CreditAction =
  | "ai-analyze" // enrich a reel breakdown (label transitions + niche) via LLM/vision
  | "ai-edit" // refine the edit plan / compile a direction via LLM
  | "ai-transcribe" // Whisper auto-captions
  | "ai-broll" // MiniMax text→video B-roll generation
  | "ai-score"; // cloud AI music (vs. the free on-device score)

// Cost per action, in credits. Roughly proportional to what each call costs
// the operator: text LLM calls are cheap, transcription mid, video gen dear.
export const CREDIT_COSTS: Record<CreditAction, number> = {
  "ai-analyze": 1,
  "ai-edit": 1,
  "ai-transcribe": 3,
  "ai-broll": 20,
  "ai-score": 5,
};

export const CREDIT_ACTION_LABELS: Record<CreditAction, string> = {
  "ai-analyze": "AI reel analysis",
  "ai-edit": "AI edit refinement",
  "ai-transcribe": "Auto-caption transcription",
  "ai-broll": "AI B-roll generation",
  "ai-score": "Cloud AI music",
};

// New users get this on first run — enough to feel the AI features before
// deciding to pay. Editing itself never touches this.
export const STARTER_CREDITS = 30;

export function creditCost(action: CreditAction): number {
  return CREDIT_COSTS[action] ?? 0;
}

// Pure spend math — the single source of truth the wallet applies and tests
// assert against. Zero/negative costs always succeed without changing balance.
export function applySpend(balance: number, cost: number): { ok: boolean; balance: number } {
  if (cost <= 0) return { ok: true, balance };
  if (balance < cost) return { ok: false, balance };
  return { ok: true, balance: balance - cost };
}

export interface PricingTier {
  id: string;
  name: string;
  price: string;
  period: string;
  credits: number; // 0 = "unlimited" (BYO key)
  tagline: string;
  perks: string[];
  highlight?: boolean;
  byoKey?: boolean;
}

// Placeholder pricing the operator tunes and wires to a real checkout. The
// "Studio" tier is deliberately bring-your-own-key: point the app at your own
// AI provider and the credit meter stops mattering entirely.
export const PRICING_TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    credits: STARTER_CREDITS,
    tagline: "A real editor, not a trial.",
    perks: [
      "Unlimited on-device editing & MP4 export",
      "Every cinematic look, transition, overlay & score",
      "Reverse-engineer any viral reel",
      `${STARTER_CREDITS} AI credits to start`,
    ],
  },
  {
    id: "creator",
    name: "Creator",
    price: "$9",
    period: "/mo",
    credits: 300,
    tagline: "For posting every week.",
    highlight: true,
    perks: [
      "Everything in Free",
      "300 AI credits / month",
      "One-prompt full edits, refined by AI",
      "Reel niche + on-frame vision analysis",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19",
    period: "/mo",
    credits: 800,
    tagline: "For daily creators & small teams.",
    perks: [
      "Everything in Creator",
      "800 AI credits / month",
      "AI B-roll generation",
      "Auto-captions (transcription)",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    price: "$49",
    period: "/mo",
    credits: 0,
    byoKey: true,
    tagline: "Bring your own AI key — no meter.",
    perks: [
      "Everything in Pro",
      "Use your own AI provider key",
      "Unlimited AI — the credit meter is off",
      "Early access to new tools",
    ],
  },
];

// Convert a tier's credit grant to a friendly string ("Unlimited" for BYO).
export function tierCreditsLabel(tier: PricingTier): string {
  return tier.byoKey || tier.credits === 0 ? "Unlimited AI" : `${tier.credits.toLocaleString()} credits`;
}
