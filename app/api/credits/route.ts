import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getOrCreateCredits } from "@/lib/credits";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    // currentUser() needed only on first-ever call to get email for welcome bonus
    const user = await currentUser();
    const email = user?.emailAddresses[0]?.emailAddress ?? "";
    const credits = await getOrCreateCredits(userId, email);
    return NextResponse.json({ credits_remaining: credits.credits_remaining });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
