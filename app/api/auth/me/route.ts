import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/dal";

/**
 * UI-only signal (show/hide the vocab-book entry point, whether to fire the
 * record-on-vocab-card call) — never treat this as the security boundary.
 * Every route that actually mutates data re-checks the session itself.
 */
export async function GET() {
  const session = await getSession();
  return NextResponse.json({ email: session?.email ?? null });
}
