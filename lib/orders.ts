import { getSupabase } from "./supabase";

export const PACKAGES = [
  { id: "starter",  name: "体验包", price_yuan: 18, credits: 80  },
  { id: "standard", name: "标准包", price_yuan: 45, credits: 220 },
  { id: "value",    name: "超值包", price_yuan: 88, credits: 500 },
] as const;

export type PackageId = (typeof PACKAGES)[number]["id"];

export interface Order {
  id: string;
  user_id: string;
  email: string;
  package_id: PackageId;
  status: "pending" | "confirmed" | "cancelled";
  created_at: string;
  confirmed_at?: string;
  confirmed_by?: string;
}

function generateOrderId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `ORD-${date}-${rand}`;
}

export async function createOrder(
  userId: string,
  email: string,
  packageId: PackageId
): Promise<Order> {
  const pkg = PACKAGES.find(p => p.id === packageId);
  if (!pkg) throw new Error(`无效的套餐 ID: ${packageId}`);

  const id = generateOrderId();
  const db = getSupabase();

  const { data, error } = await db
    .from("orders")
    .insert({ id, user_id: userId, email, package_id: packageId, status: "pending" })
    .select()
    .single();

  if (error) throw new Error(`创建订单失败: ${error.message}`);
  return data as Order;
}

export async function confirmOrder(orderId: string, adminEmail: string): Promise<void> {
  const db = getSupabase();
  const { error } = await db.rpc("confirm_order_and_grant_credits", {
    p_order_id: orderId,
    p_admin_email: adminEmail,
  });

  if (error) throw new Error(error.message || `订单 ${orderId} 处理失败`);
}

export async function cancelOrder(
  orderId: string,
  adminEmail: string,
  reason?: string
): Promise<void> {
  const db = getSupabase();
  const { error } = await db.rpc("cancel_order", {
    p_order_id: orderId,
    p_admin_email: adminEmail,
    p_reason: reason ?? null,
  });

  if (error) throw new Error(error.message || `订单 ${orderId} 取消失败`);
}

export async function listPendingOrders(): Promise<Order[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`查询订单失败: ${error.message}`);
  return (data ?? []) as Order[];
}

export async function autoCancelStaleOrders(olderThanHours = 168): Promise<number> {
  const db = getSupabase();
  const { data, error } = await db.rpc("auto_cancel_stale_orders", {
    p_older_than_hours: olderThanHours,
  });
  if (error) throw new Error(`自动取消旧订单失败: ${error.message}`);
  return (data as number) ?? 0;
}

export async function listRecentOrders(limit = 50): Promise<Order[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`查询订单失败: ${error.message}`);
  return (data ?? []) as Order[];
}
