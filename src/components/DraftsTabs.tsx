import Link from "next/link";
import type { Owner } from "@/lib/types";

/** The two halves of Drafts: editing the emails, and what auto-send does with them. */
export function DraftsTabs({ owner, active }: { owner: Owner; active: "edit" | "auto" }) {
  return (
    <nav className="drafts-tabs" aria-label="Drafts">
      <Link href={`/drafts?owner=${owner}`} className={active === "edit" ? "is-active" : ""} aria-current={active === "edit" ? "page" : undefined}>Edit your emails</Link>
      <Link href={`/drafts/auto-send?owner=${owner}`} className={active === "auto" ? "is-active" : ""} aria-current={active === "auto" ? "page" : undefined}>What auto-send sends</Link>
    </nav>
  );
}
