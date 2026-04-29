import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { confirmOrder } from "@/lib/orders";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const adminEmail = process.env.ADMIN_EMAIL;
  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? "";
  if (!adminEmail || email !== adminEmail) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  try {
    const { order_id } = await req.json() as { order_id?: string };
    if (!order_id) return NextResponse.json({ error: "缺少 order_id" }, { status: 400 });

    await confirmOrder(order_id, email);
    return NextResponse.json({ success: true, order_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
