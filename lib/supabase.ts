import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let _client: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 未配置");
  _client = createClient<Database>(url, key, { auth: { persistSession: false } });
  return _client;
}
