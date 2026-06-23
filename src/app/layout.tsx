import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "복지한입 — 흩어진 복지를 한 입에",
  description:
    "로그인 없이 말 한 줄로, 받을 수 있는 복지를 쉬운말과 음성으로 안내합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
