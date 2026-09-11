"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type React from "react";

/** A table row that opens a page when clicked anywhere; links inside still work on their own. */
export function RowLink({ href, className, children, as = "tr" }: { href: string; className?: string; children: ReactNode; as?: "tr" | "li" }) {
  const router = useRouter();
  const onClick = (event: React.MouseEvent<HTMLElement>) => { if ((event.target as HTMLElement).closest("a,button,input,select")) return; router.push(href); };
  if (as === "li") return <li className={`row-link ${className ?? ""}`} onClick={onClick}>{children}</li>;
  return <tr className={`row-link ${className ?? ""}`} onClick={onClick}>{children}</tr>;
}
