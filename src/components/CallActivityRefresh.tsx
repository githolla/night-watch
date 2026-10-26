"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CallActivityRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, 30000);
    return () => window.clearInterval(timer);
  }, [router]);
  return <div className="flex items-center gap-3 text-xs text-stone-500"><span>Updates every 30 seconds</span><button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 disabled:opacity-50">{pending ? "Updating…" : "Refresh"}</button></div>;
}
