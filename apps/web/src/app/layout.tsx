import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Harbor", template: "%s · Harbor" },
  description: "Your family's paperwork, at home.",
  /*
   * Added to an iPhone's home screen, Harbor opens as an app of its own: no address bar, no
   * Safari toolbar. The name under the icon is "Harbor" rather than the title of whichever page
   * it was added from ("Inbox · Harbor"); the icon is app/apple-icon.png. The same is said to
   * every other browser by app/manifest.ts.
   *
   * Next writes the standard `mobile-web-app-capable`; iOS before 17 only reads Apple's own
   * prefixed name, so that one is written by hand beside it.
   */
  appleWebApp: { title: "Harbor", capable: true, statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

/**
 * The browser's own chrome — the status bar of a home-screen app, the toolbar tint in Safari —
 * in the page's ground colour, so it reads as part of the page in both themes (spec §4.1).
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1723" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full font-sans text-body">{children}</body>
    </html>
  );
}
