import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { LanguageProvider } from "@/components/providers/language-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Academia del Código",
    template: "%s · Academia del Código",
  },
  description: "Aprende programación e IA con notebooks, videos y práctica guiada.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The theme script sets the theme class before React hydrates, so <html> differs from the server render.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LanguageProvider>
          {/* Every tooltip on the platform (components/ui/tip.tsx) opens after the same short delay. */}
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster position="top-right" />
          </TooltipProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
