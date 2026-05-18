import { NextRequest, NextResponse } from "next/server";
import { autoCancelStaleOrders } from "@/lib/orders";

// Vercel Cron 调度入口。Vercel 会自动带 Authorization: Bearer $CRON_SECRET。
export async function GET(req: NextRequest) {
  // fail-closed：CRON_SECRET 必填，未配置直接 500，防止任意公网访问触发批处理
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET 未配置" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const url = req.nextUrl;
    const olderThanHoursRaw = url.searchParams.get("older_than_hours");
    const olderThanHours = olderThanHoursRaw ? Number(olderThanHoursRaw) : 168;
    if (!Number.isFinite(olderThanHours) || olderThanHours < 1) {
      return NextResponse.json({ error: "older_than_hours 非法" }, { status: 400 });
    }

    const cancelled = await autoCancelStaleOrders(olderThanHours);
    return NextResponse.json({
      success: true,
      cancelled,
      older_than_hours: olderThanHours,
      ran_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
