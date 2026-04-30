import { NextRequest, NextResponse } from "next/server";
import { assertAdmin } from "@/lib/admin-auth";
import { confirmOrder } from "@/lib/orders";

export async function POST(req: NextRequest) {
  const ctx = await assertAdmin();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { order_id } = await req.json() as { order_id?: string };
    if (!order_id) return NextResponse.json({ error: "缺少 order_id" }, { status: 400 });

    await confirmOrder(order_id, ctx.email);
    return NextResponse.json({ success: true, order_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
