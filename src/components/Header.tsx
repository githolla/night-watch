import Link from "next/link";

/** Navigation named for the task, not the brand: Today, Reach-out, Accounts, Desk, Results, Settings, Lock. */
const items = [
  { href: "/", label: "Today" },
  { href: "/outreach", label: "Reach-out" },
  { href: "/targets", label: "Accounts" },
  { href: "/roles", label: "Roles" },
  { href: "/posts", label: "Posts" },
  { href: "/people", label: "People" },
  { href: "/desk", label: "Desk" },
  { href: "/runs", label: "Runs" },
  { href: "/stats", label: "Results" },
  { href: "/settings", label: "Settings" },
];

export function Header() {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
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
        <form action="/api/auth/logout" method="post">
          <button className="nav-logout" type="submit">
            <span>{String(items.length + 1).padStart(2, "0")}</span>Lock
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
