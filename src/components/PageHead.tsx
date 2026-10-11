import Link from "next/link";
import type { ReactNode } from "react";
import type { Owner } from "@/lib/types";

export const SEATS: Array<{ owner: Owner; name: string }> = [{ owner: "josh", name: "Josh" }, { owner: "suuchi", name: "Suuchi" }];

export function seatName(owner: Owner): string {
  return SEATS.find((seat) => seat.owner === owner)?.name ?? "";
}

/** The one page header: a title, a line on what the page is for, the admin's seat switch and any page actions. */
export function PageHead({ title, children, seats, actions }: {
  title: ReactNode;
  children?: ReactNode;
  seats?: { current: Owner; href: (owner: Owner) => string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="drafts-head page-title">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {(seats || actions) && (
        <div className="page-title-side">
          {actions}
          {seats && (
            <nav className="drafts-seats" aria-label={seats.label}>
              {SEATS.map((seat) => <Link key={seat.owner} href={seats.href(seat.owner)} className={seats.current === seat.owner ? "is-active" : ""} aria-current={seats.current === seat.owner ? "page" : undefined}>{seat.name}</Link>)}
            </nav>
          )}
        </div>
      )}
    </header>
  );
}
