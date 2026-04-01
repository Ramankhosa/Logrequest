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
  title: "AcademetriQ — KPI Tracking for Academic Institutions",
  description:
    "Allocate, track, measure, and improve institutional KPIs. Accreditation-mapped templates, auto DVV generation, AI recommendations, research output tracking, and competition analysis — all in one platform.",
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
