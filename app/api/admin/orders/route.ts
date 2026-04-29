import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { listRecentOrders } from "@/lib/orders";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const adminEmail = process.env.ADMIN_EMAIL;
  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? "";
  if (!adminEmail || email !== adminEmail) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  try {
    const orders = await listRecentOrders(100);
    return NextResponse.json({ orders });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
