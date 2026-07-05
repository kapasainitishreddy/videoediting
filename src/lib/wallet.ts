"use client";

// The credits wallet — balance + ledger, persisted in IndexedDB (the same
// on-device store as everything else; nothing about credits touches a server
// until the operator wires a real checkout). Exposes a tiny subscription so
// the balance chip and pricing page update the instant a credit is spent.
//
// Trust note: this is a CLIENT-side ledger. It's the right shape for a local-
// first app and for gating the operator's shared AI key in a friendly way,
// but it is not tamper-proof — a determined user can edit IndexedDB. For real
// paid enforcement the spend call should be mirrored server-side at the /api
// boundary (documented in the route). Today it gives honest UX: a visible
// balance, fair "charge only if the AI actually ran" behavior, and a clean
// out-of-credits path to the pricing page.
import { getSetting, saveSetting } from "./storage";
import { applySpend, creditCost, STARTER_CREDITS, type CreditAction } from "./credits";

const KEY = "credits:wallet";

export interface LedgerEntry {
  t: number;
  action: string;
  delta: number; // negative = spent, positive = granted
  reason: string;
}

export interface Wallet {
  balance: number;
  starterGranted: boolean;
  ledger: LedgerEntry[];
}

// In-memory cache + change subscription so multiple components share one truth.
let cache: Wallet | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

export function onWalletChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function persist(w: Wallet) {
  cache = w;
  await saveSetting(KEY, JSON.stringify(w));
  notify();
}

// Read the wallet, granting the one-time starter balance on first ever run.
export async function getWallet(): Promise<Wallet> {
  if (cache) return cache;
  const raw = await getSetting(KEY);
  if (raw) {
    try {
      cache = JSON.parse(raw) as Wallet;
      return cache;
    } catch {
      // corrupt — fall through to a fresh grant
    }
  }
  const fresh: Wallet = {
    balance: STARTER_CREDITS,
    starterGranted: true,
    ledger: [{ t: Date.now(), action: "grant", delta: STARTER_CREDITS, reason: "Welcome credits" }],
  };
  await persist(fresh);
  return fresh;
}

export async function getBalance(): Promise<number> {
  return (await getWallet()).balance;
}

// Spend for an action. Returns ok:false (without charging) when the balance
// can't cover it — the caller then shows the pricing prompt.
export async function spendCredits(
  action: CreditAction,
  reason?: string
): Promise<{ ok: boolean; balance: number; cost: number }> {
  const cost = creditCost(action);
  const w = await getWallet();
  const r = applySpend(w.balance, cost);
  if (!r.ok) return { ok: false, balance: w.balance, cost };
  const next: Wallet = {
    ...w,
    balance: r.balance,
    ledger: [{ t: Date.now(), action, delta: -cost, reason: reason ?? action }, ...w.ledger].slice(0, 50),
  };
  await persist(next);
  return { ok: true, balance: next.balance, cost };
}

// Give credits back — used to refund when an AI call turned out to be
// unavailable (no key configured), and by the checkout stub on "purchase".
export async function grantCredits(amount: number, reason: string): Promise<Wallet> {
  const w = await getWallet();
  const next: Wallet = {
    ...w,
    balance: w.balance + amount,
    ledger: [{ t: Date.now(), action: "grant", delta: amount, reason }, ...w.ledger].slice(0, 50),
  };
  await persist(next);
  return next;
}

// Spend a credit, run the AI work, and REFUND if the work reported it wasn't
// actually available (e.g. the operator hasn't configured any key). This keeps
// charging fair: users are only debited when the AI genuinely ran. `run`
// returns { available } — false triggers the refund.
export async function withCredit<T extends { available?: boolean }>(
  action: CreditAction,
  run: () => Promise<T>
): Promise<{ charged: boolean; refunded: boolean; result: T | null; broke: boolean }> {
  const spend = await spendCredits(action, action);
  if (!spend.ok) return { charged: false, refunded: false, result: null, broke: true };
  try {
    const result = await run();
    if (result && result.available === false) {
      await grantCredits(creditCost(action), `refund: ${action} unavailable`);
      return { charged: false, refunded: true, result, broke: false };
    }
    return { charged: true, refunded: false, result, broke: false };
  } catch (e) {
    await grantCredits(creditCost(action), `refund: ${action} failed`);
    throw e;
  }
}
