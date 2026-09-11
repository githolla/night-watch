import { redirect } from "next/navigation";

/** Home is the reach-out list. The older overview still lives at /today. */
export default function Home() {
  redirect("/outreach");
}
