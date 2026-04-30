import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export type AdminContext = { userId: string; email: string };

export async function assertAdmin(): Promise<AdminContext | NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const adminEmail = process.env.ADMIN_EMAIL;
  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? "";
  if (!adminEmail || email !== adminEmail) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  return { userId, email };
}
