import Link from "next/link";
import type { Owner } from "@/lib/types";

/** Drafts in two parts: editing the emails, and what has gone out. Auto-send has its own tab. */
export function DraftsTabs({ owner, active }: { owner: Owner; active: "edit" | "sent" }) {
  return (
    <nav className="drafts-tabs" aria-label="Drafts">
      <Link href={`/drafts?owner=${owner}`} className={active === "edit" ? "is-active" : ""} aria-current={active === "edit" ? "page" : undefined}>Edit your emails</Link>
      <Link href={`/drafts/sent?owner=${owner}`} className={active === "sent" ? "is-active" : ""} aria-current={active === "sent" ? "page" : undefined}>What was recently sent</Link>
    </nav>
  );
}
