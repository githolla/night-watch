import { OutreachNav } from "./OutreachNav";
import type { Owner } from "@/lib/types";

/** Drafts in two parts: editing the emails, and what has gone out. Auto-send has its own tab. */
export function DraftsTabs({ owner, active }: { owner: Owner; active: "edit" | "sent" }) {
  return <OutreachNav owner={owner} active={active === "edit" ? "drafts" : "sent"} />;
}
