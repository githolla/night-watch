import { redirect } from "next/navigation";

/** Auto-send moved to its own tab; old links still land there. */
export default async function OldAutoSendPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const { owner } = await searchParams;
  redirect(owner === "josh" || owner === "suuchi" ? `/auto-send?owner=${owner}` : "/auto-send");
}
