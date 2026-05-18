import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export type AdminContext = { userId: string; email: string };

// 支持 ADMIN_EMAILS（逗号分隔多个）+ 向后兼容 ADMIN_EMAIL（单个）
function getAdminEmails(): string[] {
  const multi = process.env.ADMIN_EMAILS?.trim();
  if (multi) return multi.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const single = process.env.ADMIN_EMAIL?.trim();
  return single ? [single.toLowerCase()] : [];
}

export async function assertAdmin(): Promise<AdminContext | NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const admins = getAdminEmails();
  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? "";
  if (admins.length === 0 || !admins.includes(email.toLowerCase())) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  return { userId, email };
}
