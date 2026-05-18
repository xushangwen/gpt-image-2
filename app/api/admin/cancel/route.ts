import { NextRequest, NextResponse } from "next/server";
import { assertAdmin } from "@/lib/admin-auth";
import { cancelOrder } from "@/lib/orders";

export async function POST(req: NextRequest) {
  const ctx = await assertAdmin();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { order_id, reason } = (await req.json()) as {
      order_id?: string;
      reason?: string;
    };
    if (!order_id) return NextResponse.json({ error: "缺少 order_id" }, { status: 400 });

    const trimmedReason = reason?.trim().slice(0, 200) || undefined;
    await cancelOrder(order_id, ctx.email, trimmedReason);
    return NextResponse.json({ success: true, order_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
