import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Investment Tracker",
  description: "Personal investment dashboard for workbook-backed purchases, values, & entries.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
