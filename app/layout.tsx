import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Noto_Sans_SC } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkAppearance, clerkLocalization } from "@/lib/clerk-appearance";
import "./globals.css";
import "remixicon/fonts/remixicon.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
});

// 仅加载首屏实际用到的两个 weight，每个中文字体 ~200KB；删除几乎不用的 300
const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-cn",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "ImageGen — AI 图像生成",
  description: "由 GPT-Image-2 驱动的 AI 图像生成工具",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider appearance={clerkAppearance} localization={clerkLocalization}>
      <html lang="zh-CN" className="h-full">
        <head>
          {/* 在 React hydration 之前同步设置 data-theme，避免首屏 dark→light 闪烁。
              页面正常 useEffect 仍会持久化用户的切换偏好（key="theme"） */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var s=localStorage.getItem('theme');var d=s?s==='dark':!window.matchMedia('(prefers-color-scheme: light)').matches;document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`,
            }}
          />
        </head>
        <body className={`${spaceGrotesk.variable} ${notoSansSC.variable} antialiased h-full`}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
