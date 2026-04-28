import { getSupabase } from "./supabase";
import { addCredits } from "./credits";

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
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
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

  const { data: order, error: fetchError } = await db
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("status", "pending")
    .single();

  if (fetchError || !order) throw new Error(`订单 ${orderId} 不存在或已处理`);

  const pkg = PACKAGES.find(p => p.id === (order as Order).package_id);
  if (!pkg) throw new Error("订单套餐数据异常");

  const { error: updateError } = await db
    .from("orders")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: adminEmail })
    .eq("id", orderId);

  if (updateError) throw new Error(`更新订单状态失败: ${updateError.message}`);

  await addCredits((order as Order).user_id, pkg.credits, orderId, adminEmail);
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

export async function listRecentOrders(limit = 50): Promise<Order[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`查询订单失败: ${error.message}`);
  return (data ?? []) as Order[];
}
