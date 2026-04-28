import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createOrder, PACKAGES, type PackageId } from "@/lib/orders";
import { getOrCreateCredits } from "@/lib/credits";

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const body = await req.json();
    const { package_id } = body as { package_id?: string };

    const validIds = PACKAGES.map(p => p.id) as string[];
    if (!package_id || !validIds.includes(package_id)) {
      return NextResponse.json({ error: "无效的套餐 ID" }, { status: 400 });
    }

    const user = await currentUser();
    const email = user?.emailAddresses[0]?.emailAddress ?? "";

    // Ensure user exists in credits table
    await getOrCreateCredits(userId, email);

    const order = await createOrder(userId, email, package_id as PackageId);
    return NextResponse.json({ order_id: order.id, package_id, email });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
