import Link from "next/link";
import type { Owner } from "@/lib/types";

/** Drafts in three parts: editing the emails, what auto-send will send, and what has gone out. */
export function DraftsTabs({ owner, active }: { owner: Owner; active: "edit" | "auto" | "sent" }) {
  return (
    <nav className="drafts-tabs" aria-label="Drafts">
      <Link href={`/drafts?owner=${owner}`} className={active === "edit" ? "is-active" : ""} aria-current={active === "edit" ? "page" : undefined}>Edit your emails</Link>
      <Link href={`/drafts/auto-send?owner=${owner}`} className={active === "auto" ? "is-active" : ""} aria-current={active === "auto" ? "page" : undefined}>What auto-send sends</Link>
      <Link href={`/drafts/sent?owner=${owner}`} className={active === "sent" ? "is-active" : ""} aria-current={active === "sent" ? "page" : undefined}>What was recently sent</Link>
    </nav>
  );
}
