import Link from "next/link";

/** Two pages in the bar: the reach-out list and the desk. The rest is under More. */
const items = [
  { href: "/outreach", label: "Reach-out" },
  { href: "/desk", label: "Desk" },
];

/** Everything else lives behind one menu, so the two pages that matter are the whole bar. */
const more = [
  { href: "/today", label: "Today" },
  { href: "/targets", label: "All companies" },
  { href: "/roles", label: "Roles" },
  { href: "/posts", label: "Posts" },
  { href: "/people", label: "People" },
  { href: "/runs", label: "Runs" },
  { href: "/stats", label: "Results" },
  { href: "/settings", label: "Settings" },
];

export function Header() {
  return (
    <header className="topbar">
      <Link href="/outreach" className="brand">
        <strong>NINE—67</strong>
        <span>NIGHT WATCH / SIGNAL INTELLIGENCE</span>
      </Link>
      <nav className="nav">
        {items.map((item, index) => (
          <Link key={item.href} href={item.href}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.label}
          </Link>
        ))}
        <details className="nav-more">
          <summary><span>{String(items.length + 1).padStart(2, "0")}</span>More</summary>
          <div>{more.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}</div>
        </details>
        <form action="/api/auth/logout" method="post">
          <button className="nav-logout" type="submit">
            <span>{String(items.length + 2).padStart(2, "0")}</span>Lock
          </button>
        </form>
      </nav>
      <div className="system-mark">
        <i />
        ONLINE
      </div>
    </header>
  );
}
