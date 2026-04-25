import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Noto_Sans_SC } from "next/font/google";
import "./globals.css";
import "remixicon/fonts/remixicon.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
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
    <html lang="zh-CN" className="h-full">
      <body className={`${spaceGrotesk.variable} ${notoSansSC.variable} antialiased h-full`}>
        {children}
      </body>
    </html>
  );
}
