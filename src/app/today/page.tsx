import { redirect } from "next/navigation";

/** The old overview became Home. */
export default function Overview() {
  redirect("/");
}
