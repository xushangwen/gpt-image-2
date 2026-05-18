import { NextRequest, NextResponse } from "next/server";
import { assertAdmin } from "@/lib/admin-auth";
import { listUserTransactions } from "@/lib/credits";

export async function GET(req: NextRequest) {
  const ctx = await assertAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const userId = req.nextUrl.searchParams.get("user_id");
  if (!userId) return NextResponse.json({ error: "缺少 user_id" }, { status: 400 });

  try {
    const transactions = await listUserTransactions(userId, 100);
    return NextResponse.json({ transactions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
