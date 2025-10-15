import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { PHProvider } from "@/components/providers/posthog-provider";
import { CrispChat } from "@/components/providers/CrispChat";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mediar dashboard",
  description: "AI-powered desktop automation for browser workflows and data entry",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://mediar.ai'),
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' }
  ],
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" }
    ],
    apple: { url: "/icon.svg", type: "image/svg+xml" }
  },
  openGraph: {
    title: "Mediar dashboard",
    description: "AI-powered desktop automation for browser workflows and data entry",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mediar dashboard",
    description: "AI-powered desktop automation for browser workflows and data entry",
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={inter.className}>
          <PHProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="light"
              disableTransitionOnChange
            >
              <main className="min-h-screen stable-container pt-4">
                {children}
              </main>
              <Toaster />
              <CrispChat />
            </ThemeProvider>
          </PHProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
 