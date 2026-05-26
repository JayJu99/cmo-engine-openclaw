import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DashboardShell } from "@/components/dashboard/shell";
import { getCmoAuthShellStatus } from "@/lib/cmo/auth-shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CMO Engine OpenClaw",
  description: "AI command center for OpenClaw marketing agents",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const authStatus = await getCmoAuthShellStatus();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#fbfcff] text-slate-950">
        <DashboardShell authStatus={authStatus}>{children}</DashboardShell>
      </body>
    </html>
  );
}
