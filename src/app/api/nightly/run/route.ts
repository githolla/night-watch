import { requireUser } from "@/lib/auth";
import { runNightly } from "@/lib/pipeline";

export const maxDuration = 300;

export async function POST() {
  try {
    await requireUser();
    // Keep each request inside a serverless execution window. The client runs a
    // visible sequence of these one-company jobs and persists every result.
    return Response.json(await runNightly({ accountLimit: 1 }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Research run failed" },
      { status: 500 },
    );
  }
}
