import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "Family Mind · исследование семьи",
  description:
    "Локальное исследовательское пространство. Только синтетические данные.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
