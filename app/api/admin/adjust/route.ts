import { NextRequest, NextResponse } from "next/server";
import { assertAdmin } from "@/lib/admin-auth";
import { adminAdjustCredits } from "@/lib/credits";

export async function POST(req: NextRequest) {
  const ctx = await assertAdmin();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { user_id, delta, reason } = (await req.json()) as {
      user_id?: string;
      delta?: number;
      reason?: string;
    };

    if (!user_id) return NextResponse.json({ error: "缺少 user_id" }, { status: 400 });
    if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
      return NextResponse.json({ error: "delta 必须是非零整数" }, { status: 400 });
    }
    if (Math.abs(delta) > 100000) {
      return NextResponse.json({ error: "单次调整不能超过 ±100000" }, { status: 400 });
    }
    const trimmedReason = reason?.trim().slice(0, 200);
    if (!trimmedReason) {
      return NextResponse.json({ error: "请填写调整原因" }, { status: 400 });
    }

    const newBalance = await adminAdjustCredits(user_id, delta, trimmedReason, ctx.email);
    return NextResponse.json({ success: true, new_balance: newBalance });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
