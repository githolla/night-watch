import { redirect } from "next/navigation";

/** Home is the desk: today's people and their drafts. The list is one click away, the overview lives at /today. */
export default function Home() {
  redirect("/desk");
}
