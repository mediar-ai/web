import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { PHProvider } from "@/components/providers/posthog-provider";
import { CrispChat } from "@/components/providers/CrispChat";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "700"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' }
  ],
};

export const metadata: Metadata = {
  title: "Mediar dashboard",
  description: "AI-powered desktop automation for browser workflows and data entry",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://mediar.ai'),
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
        <body className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} ${spaceGrotesk.className}`}>
          <PHProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="light"
              disableTransitionOnChange
            >
              <main className="min-h-screen stable-container pt-4">
                {children}
              </main>
              <Toaster position="top-center" />
              {/* <CrispChat /> */}
            </ThemeProvider>
          </PHProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
 