import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import AuthCleanupProvider from "@/components/AuthCleanupProvider";
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
        <AuthCleanupProvider>{children}</AuthCleanupProvider>
      </body>
    </html>
  );
}
