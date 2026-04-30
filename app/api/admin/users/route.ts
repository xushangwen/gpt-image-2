import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/admin-auth";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  const ctx = await assertAdmin();
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { data, error } = await getSupabase()
      .from("user_credits")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ users: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
