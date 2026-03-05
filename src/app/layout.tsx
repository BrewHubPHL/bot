import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import AuthCleanupProvider from "@/components/AuthCleanupProvider";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair" });

export const metadata: Metadata = {
  title: "BrewHub PHL | Neighborhood Coffee & Workspace",
  description: "A premium coffee experience coming soon to Point Breeze, Philadelphia.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} antialiased`}>
      <body>
        <NuqsAdapter>
          <AuthCleanupProvider>{children}</AuthCleanupProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
