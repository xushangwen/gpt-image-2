import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/admin-auth";
import { listRecentOrders } from "@/lib/orders";

export async function GET() {
  const ctx = await assertAdmin();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const orders = await listRecentOrders(100);
    return NextResponse.json({ orders });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
