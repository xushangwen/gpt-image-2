// 客户端模块之间的事件契约（避免在组件间 props drilling 或引入 Context）
// 不要在调用 window 之前判断 typeof —— 仅在 client component 使用

export const CREDITS_DEDUCT_EVENT = "credits-deduct";
export const CREDITS_REFRESH_EVENT = "credits-refresh";

export interface CreditsDeductDetail {
  count: number;
}

export function emitCreditsDeduct(count: number) {
  window.dispatchEvent(
    new CustomEvent<CreditsDeductDetail>(CREDITS_DEDUCT_EVENT, { detail: { count } })
  );
}

export function emitCreditsRefresh() {
  window.dispatchEvent(new CustomEvent(CREDITS_REFRESH_EVENT));
}

export function subscribeCreditsDeduct(handler: (count: number) => void): () => void {
  const fn = (e: Event) => handler((e as CustomEvent<CreditsDeductDetail>).detail.count);
  window.addEventListener(CREDITS_DEDUCT_EVENT, fn);
  return () => window.removeEventListener(CREDITS_DEDUCT_EVENT, fn);
}

export function subscribeCreditsRefresh(handler: () => void): () => void {
  window.addEventListener(CREDITS_REFRESH_EVENT, handler);
  return () => window.removeEventListener(CREDITS_REFRESH_EVENT, handler);
}
