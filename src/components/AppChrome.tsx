"use client";

import { usePathname } from "next/navigation";
import { Header } from "./Header";

/** Pages that stand alone, without the app bar: signing in, setup, accepting an invite, a prospect's gift. */
const BARE = [/^\/login(\/|$)/, /^\/setup(\/|$)/, /^\/invite\//, /^\/gift\//];

/**
 * The app bar lives in the root layout so it stays mounted while pages change. Rendered inside each page it
 * was torn down and rebuilt on every click, refetching the signed-in user and the nav counts each time.
 */
export function AppChrome() {
  const pathname = usePathname();
  if (BARE.some((pattern) => pattern.test(pathname))) return null;
  return <Header />;
}
