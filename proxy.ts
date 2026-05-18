import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Vercel Cron 用 CRON_SECRET 鉴权，跳过 Clerk
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/terms",
  "/privacy",
  "/api/cron(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
