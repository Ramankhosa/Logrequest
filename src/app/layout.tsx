import type { Metadata } from "next";
import { Manrope, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Academic Intelligence Platform",
  description:
    "An academic SaaS starter for tenant provisioning, identity governance, staged imports, and intelligent dashboards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${sourceSerif.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
