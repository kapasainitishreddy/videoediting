"use client";

// Live credits balance, shared across the app. Reads the on-device wallet and
// re-reads whenever a credit is spent or granted (via the wallet's change
// subscription), so the number is always current without prop-drilling.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Gem } from "lucide-react";
import { getBalance, onWalletChange } from "@/lib/wallet";

export function useBalance(): number | null {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      getBalance()
        .then((b) => {
          if (alive) setBalance(b);
        })
        .catch(() => {});
    };
    load();
    const off = onWalletChange(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return balance;
}

export default function CreditsChip({ className = "" }: { className?: string }) {
  const router = useRouter();
  const balance = useBalance();
  return (
    <button
      onClick={() => router.push("/pricing")}
      aria-label={`${balance ?? 0} AI credits — view plans`}
      className={`flex items-center gap-1.5 rounded-full border border-card-border bg-card px-3 py-1.5 text-xs font-semibold ${
        balance === 0 ? "text-amber-400" : "text-neutral-200"
      } ${className}`}
    >
      <Gem size={13} className="text-accent" />
      {balance === null ? "—" : balance.toLocaleString()}
      <span className="text-neutral-500">credits</span>
    </button>
  );
}
