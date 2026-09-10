import { requireUser } from "@/lib/auth";
import { runNightly } from "@/lib/pipeline";

export const maxDuration = 300;

export async function POST() {
  try {
    await requireUser();
    return Response.json(await runNightly({ accountLimit: 10 }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Research run failed" },
      { status: 500 },
    );
  }
}
